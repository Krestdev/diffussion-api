import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  ContractStatus,
  CourrierDirection,
  DossierStatus,
  Prisma,
  ProjectContentType,
  ProjectStatus,
} from '../../generated/prisma/client';
import {
  DEFAULT_TAKE,
  PaginationQueryDto,
} from '../../common/dto/pagination.query.dto';
import { ActivityService } from '../../activity/activity.service';
import { AuditLog } from '../../activity/decorators/audit-log.decorator';
import { AccessService } from '../../auth/access/access.service';
import { ownCompanyFilter } from '../../common/utils/company-referentials';
import { Permission } from '../../auth/permissions';
import {
  assertActiveUsers,
  visibleProjectWhere,
} from '../../common/utils/referential-access';
import {
  assertCorrespondentActive,
  findOrCreateCorrespondent,
} from '../../common/utils/referential-guards';
import { DatabaseService } from '../../database/database.service';
import { COURRIER_DONE } from './project-cascade';
import { NotificationsService } from '../../notifications/notifications.service';
import { overdueWhere } from '../../instructions/instruction-overdue';
import { FindProjectsQueryDto } from './dto/find-projects.query.dto';
import { UpdateProjectDto } from './dto/update-project.dto';
import { can } from '../../auth/access/permission-checks';
import { ActionStates } from '../../workflow/action-states';

const projectInclude = {
  company: { select: { id: true, code: true, name: true } },
  maitreOuvrage: { select: { id: true, name: true } },
  responsible: { select: { id: true, name: true } },
  _count: { select: { contracts: true, dossiers: true } },
} satisfies Prisma.ProjectInclude;

// A contract "ends soon" within this many days (the metrics card).
const ENDING_SOON_DAYS = 60;

export { COURRIER_DONE };

/**
 * Projects. Since 2026-11-23 they come from the CREAPP core (as EXPENZO's): the core's console
 * creates, edits, suspends, closes and deletes them, and Diffusion keeps read-only copies under the
 * same ids (src/core/project-sync.ts). Here they are read, offered in the forms and measured;
 * Diffusion's own fields (what the project holds, mode, maître d'ouvrage) are set with
 * project.update, and who may open it (ProjectAccess, see visibleProjectWhere) by its responsible
 * or an administrator. Each belongs to one company: seen by that company's users only.
 */
@Injectable()
export class ProjectService {
  constructor(
    private readonly database: DatabaseService,
    // Read by @AuditLog through `this.activity`.
    private readonly activity: ActivityService,
    private readonly access: AccessService,
    private readonly notifications: NotificationsService,
  ) {}

  /**
   * The projects page in one call: the filtered, paginated list plus its
   * metric cards. `metrics` ignore the filters, so the cards and tab counts
   * stay put while the user searches or switches tab.
   */
  async findAll(query: FindProjectsQueryDto, userId: string) {
    const contains = query.search
      ? { contains: query.search, mode: 'insensitive' as const }
      : undefined;
    const company = await ownCompanyFilter(this.access, this.database, userId);
    // Platform administrators: every company's, or the one asked for.
    const companyScope: Prisma.ProjectWhereInput =
      company ?? (query.companyId ? { companyId: query.companyId } : {});
    const statuses = (query.statuses ?? '')
      .split(',')
      .filter((s): s is ProjectStatus =>
        (Object.values(ProjectStatus) as string[]).includes(s),
      );
    const where: Prisma.ProjectWhereInput = {
      ...companyScope,
      status: query.status ?? (statuses.length ? { in: statuses } : undefined),
      OR: contains && [{ name: contains }, { reference: contains }],
      AND: [await this.visibleTo(userId)],
    };
    const skip = query.skip ?? 0;
    const take = query.take ?? DEFAULT_TAKE;

    const [[data, total], metrics] = await Promise.all([
      this.database.$transaction([
        this.database.project.findMany({
          where,
          orderBy: { name: 'asc' },
          include: projectInclude,
          skip,
          take,
        }),
        this.database.project.count({ where }),
      ]),
      this.metrics(companyScope),
    ]);

    return { data, total, skip, take, metrics };
  }

  // Unrestricted: used internally and by @AuditLog. Users go through
  // findOneFor.
  async findOne(id: string) {
    const project = await this.database.project.findUnique({
      where: { id },
      include: projectInclude,
    });
    if (!project) {
      throw new NotFoundException(`Project ${id} not found`);
    }
    return project;
  }

  // The project page: the project and what is going on in it.
  async findOneFor(id: string, userId: string) {
    await this.assertVisible(id, userId);
    const [project, metrics] = await Promise.all([
      this.findOne(id),
      this.projectMetrics(id),
    ]);
    return { ...project, metrics, actions: this.actionsOf() };
  }

  /**
   * What the person may do on the project here: only Diffusion's own settings of it (edit); its
   * creation, changes and status belong to the core's console (owner standard: hidden when the
   * role can never do it).
   */
  actionsOf() {
    return new ActionStates<'edit'>().addIf(
      can(Permission.PROJECT_UPDATE),
      'edit',
    ).all;
  }

  /**
   * Diffusion's own settings of the project: what it holds, its mode and maître d'ouvrage. The
   * core's fields (name, reference, responsible, dates, status) are only written by the sync.
   */
  @AuditLog({
    action: 'project.updated',
    entityType: 'project',
    operation: 'UPDATE',
  })
  async update(id: string, dto: UpdateProjectDto, actingUserId: string) {
    const project = await this.findOne(id);
    const { maitreOuvrageName, ...data } = dto;
    await this.assertManages(project.companyId, actingUserId);
    await this.assertLinks(data, project, project.companyId);
    await this.assertContentFits(project, data.contentType);
    const maitreOuvrageId = await this.maitreOuvrageId(
      data,
      maitreOuvrageName,
      project.companyId,
    );
    return this.database.project.update({
      where: { id },
      data: { ...data, maitreOuvrageId },
      include: projectInclude,
    });
  }

  async getAccess(id: string, userId: string) {
    await this.assertVisible(id, userId);
    return this.accessList(id);
  }

  // Replaces the list. The project's responsible, or an administrator of its
  // company (settings.update there), may.
  async setAccess(id: string, userIds: string[], actingUserId: string) {
    const project = await this.findOne(id);
    if (
      project.responsibleId !== actingUserId &&
      !(await this.access.hasAtCompany(
        actingUserId,
        Permission.SETTINGS_UPDATE,
        project.companyId,
      ))
    ) {
      throw new ForbiddenException(
        "Only the project's responsible or an administrator can change who may open it",
      );
    }
    const before = (await this.accessList(id)).map((user) => user.id);
    const allowed = await assertActiveUsers(this.database, userIds);
    await this.database.$transaction([
      this.database.projectAccess.deleteMany({ where: { projectId: id } }),
      this.database.projectAccess.createMany({
        data: allowed.map((userId) => ({ projectId: id, userId })),
      }),
    ]);
    await this.activity.tryRecord({
      action: 'project.access.updated',
      entityType: 'project',
      entityId: id,
      changes: { authorized: [before, allowed] },
    });
    await this.notifications.notifyAccessChanged(
      allowed.filter((userId) => !before.includes(userId)),
      actingUserId,
      `Vous avez désormais accès au projet « ${project.name} ».`,
    );
    return this.accessList(id);
  }

  // What was done on the project itself, latest first.
  async history(id: string, userId: string, query: PaginationQueryDto) {
    await this.assertVisible(id, userId);
    return this.activity.findAll(
      {
        entityType: 'project',
        entityId: id,
        skip: query.skip,
        take: query.take,
      },
      // Seen by them, so of their company: its entries are that company's.
      [(await this.access.companyOf(userId)) ?? ''].filter(Boolean),
    );
  }

  private accessList(projectId: string) {
    return this.database.user.findMany({
      // Not the people deleted in the core (C9).
      where: { projectAccesses: { some: { projectId } }, deletedAt: null },
      select: { id: true, name: true, email: true },
      orderBy: { name: 'asc' },
    });
  }

  // Its own company's projects (open to them).
  private async visibleTo(userId: string): Promise<Prisma.ProjectWhereInput> {
    const company = await ownCompanyFilter(this.access, this.database, userId);
    return company ? { ...company, ...visibleProjectWhere(userId) } : {};
  }

  // A project is managed by whoever holds the permission in its company.
  private async assertManages(
    companyId: string,
    userId: string,
    permission: Permission = Permission.PROJECT_UPDATE,
  ) {
    await this.access.assertManages(userId, permission, companyId, 'Ce projet');
  }

  // A project the user may not open is reported as not found.
  private async assertVisible(id: string, userId: string) {
    const visible = await this.database.project.count({
      where: { id, AND: [await this.visibleTo(userId)] },
    });
    if (!visible) {
      throw new NotFoundException(`Project ${id} not found`);
    }
  }

  private async metrics(companyScope: Prisma.ProjectWhereInput) {
    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    // Weeks start on Monday.
    const startOfWeek = new Date(
      now.getFullYear(),
      now.getMonth(),
      now.getDate() - ((now.getDay() + 6) % 7),
    );
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const inProject = { project: companyScope };

    const [
      byStatusRows,
      createdThisMonth,
      contracts,
      contractsEndingSoon,
      dossiers,
      dossiersCreatedThisWeek,
      withoutResponsible,
    ] = await Promise.all([
      this.database.project.groupBy({
        by: ['status'],
        where: companyScope,
        _count: true,
      }),
      this.database.project.count({
        where: { ...companyScope, createdAt: { gte: startOfMonth } },
      }),
      this.database.contract.count({ where: inProject }),
      this.database.contract.count({
        where: { ...inProject, endDate: endingWithin(ENDING_SOON_DAYS, today) },
      }),
      this.database.dossier.count({ where: inProject }),
      this.database.dossier.count({
        where: { ...inProject, createdAt: { gte: startOfWeek } },
      }),
      this.database.project.count({
        where: {
          ...companyScope,
          status: ProjectStatus.ACTIVE,
          responsibleId: null,
        },
      }),
    ]);

    const byStatus = Object.fromEntries(
      Object.values(ProjectStatus).map((status) => [
        status,
        byStatusRows.find((row) => row.status === status)?._count ?? 0,
      ]),
    ) as Record<ProjectStatus, number>;

    return {
      byStatus,
      createdThisMonth,
      contracts,
      contractsEndingSoon,
      dossiers,
      dossiersCreatedThisWeek,
      withoutResponsible,
    };
  }

  // The project page's cards.
  private async projectMetrics(projectId: string) {
    // Effets dispatched to the project (or one of its contracts) directly,
    // or in one of its dossiers.
    const inProject: Prisma.CourrierWhereInput = {
      OR: [{ projectId }, { dossier: { projectId } }],
    };
    const open = { status: { notIn: COURRIER_DONE } };
    // Tasks of its dossiers, and of its contracts (tasks without a dossier).
    // Both are OR filters: combined with AND, never spread into one object
    // (the second OR would replace the first).
    const overdue: Prisma.InstructionWhereInput = {
      AND: [
        { OR: [{ dossier: { projectId } }, { contract: { projectId } }] },
        overdueWhere(new Date()),
      ],
    };
    const [
      contractsSigning,
      dossiersActive,
      incoming,
      outgoing,
      overdueCount,
      firstOverdue,
      courriers,
      authorized,
    ] = await Promise.all([
      this.database.contract.count({
        where: { projectId, status: ContractStatus.ACTIVE, signedAt: null },
      }),
      this.database.dossier.count({
        where: {
          projectId,
          status: { notIn: [DossierStatus.CLOSED, DossierStatus.ARCHIVED] },
        },
      }),
      this.database.courrier.count({
        where: { ...inProject, ...open, direction: CourrierDirection.ENTRANT },
      }),
      this.database.courrier.count({
        where: { ...inProject, ...open, direction: CourrierDirection.SORTANT },
      }),
      this.database.instruction.count({ where: overdue }),
      this.database.instruction.findFirst({
        where: overdue,
        orderBy: [{ dueDate: 'asc' }, { agentDueDate: 'asc' }],
        select: { number: true },
      }),
      this.database.courrier.count({ where: inProject }),
      this.database.projectAccess.count({ where: { projectId } }),
    ]);
    return {
      contractsSigning,
      dossiersActive,
      openCourriers: { incoming, outgoing },
      overdueInstructions: {
        count: overdueCount,
        firstReference: firstOverdue?.number ?? null,
      },
      courriers,
      authorized,
    };
  }

  // Its kind only changes when what it already holds fits the new one.
  private async assertContentFits(
    project: { id: string; contentType: ProjectContentType },
    wanted?: ProjectContentType,
  ) {
    if (!wanted || wanted === project.contentType) return;
    if (wanted === ProjectContentType.CONTRATS) {
      const dossiers = await this.database.dossier.count({
        where: { projectId: project.id, contractId: null },
      });
      if (dossiers > 0) {
        throw new ConflictException(
          'Ce projet contient des dossiers hors contrat : rattachez-les à un contrat ou déplacez-les avant de changer son type',
        );
      }
      return;
    }
    const contracts = await this.database.contract.count({
      where: { projectId: project.id },
    });
    if (contracts > 0) {
      throw new ConflictException(
        'Ce projet contient des contrats : déplacez-les avant de changer son type',
      );
    }
  }

  // The maître d'ouvrage given by name: found or created — on the
  // project's company. `undefined` keeps the one given by id, or the current
  // one.
  private async maitreOuvrageId(
    data: { maitreOuvrageId?: string },
    name: string | undefined,
    companyId: string,
  ) {
    if (name === undefined) return data.maitreOuvrageId;
    if (data.maitreOuvrageId) {
      throw new BadRequestException(
        'Give the maître d’ouvrage by id or by name, not both',
      );
    }
    return findOrCreateCorrespondent(this.database, name, companyId);
  }

  // The maître d'ouvrage must be an active correspondent of the project's
  // company — checked only when it changes.
  private async assertLinks(
    dto: { maitreOuvrageId?: string },
    current: { maitreOuvrageId: string | null } | undefined,
    companyId: string,
  ) {
    if (
      dto.maitreOuvrageId &&
      dto.maitreOuvrageId !== current?.maitreOuvrageId
    ) {
      await assertCorrespondentActive(
        this.database,
        dto.maitreOuvrageId,
        companyId,
      );
    }
  }
}

// From `today` to `days` days later, both included.
export function endingWithin(days: number, today: Date) {
  const last = new Date(today);
  last.setDate(last.getDate() + days + 1);
  return { gte: today, lt: last };
}
