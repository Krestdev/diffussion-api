import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  ContractStatus,
  CourrierDirection,
  DossierStatus,
  Prisma,
  ProjectStatus,
  UserStatus,
} from '../../../generated/prisma/client';
import {
  DEFAULT_TAKE,
  PaginationQueryDto,
} from '../../common/dto/pagination.query.dto';
import { ActivityService } from '../../activity/activity.service';
import { AuditLog } from '../../activity/decorators/audit-log.decorator';
import { assertAdministers, RbacService } from '../../auth/rbac/rbac.service';
import {
  assertSiteExists,
  ownSiteFilter,
} from '../../common/utils/site-referentials';
import { PermissionCode } from '../../auth/rbac/rbac.constants';
import {
  assertActiveUsers,
  visibleProjectWhere,
} from '../../common/utils/referential-access';
import {
  assertCorrespondentActive,
  findOrCreateCorrespondent,
} from '../../common/utils/referential-guards';
import { DatabaseService } from '../../database/database.service';
import { cascadeProjectStatus, COURRIER_DONE } from './project-cascade';
import { NotificationsService } from '../../notifications/notifications.service';
import { overdueWhere } from '../../instructions/instruction-overdue';
import { CreateProjectDto } from './dto/create-project.dto';
import { FindProjectsQueryDto } from './dto/find-projects.query.dto';
import { UpdateProjectDto } from './dto/update-project.dto';

const projectInclude = {
  site: { select: { id: true, code: true, name: true } },
  maitreOuvrage: { select: { id: true, name: true } },
  responsible: { select: { id: true, name: true } },
  _count: { select: { contracts: true, dossiers: true } },
} satisfies Prisma.ProjectInclude;

// A contract "ends soon" within this many days (the metrics card).
const ENDING_SOON_DAYS = 60;

// The status a project may move to from each one: one step forward or back.
const NEXT_STATUSES: Record<ProjectStatus, ProjectStatus[]> = {
  [ProjectStatus.ACTIVE]: [ProjectStatus.CLOSED],
  [ProjectStatus.CLOSED]: [ProjectStatus.ACTIVE, ProjectStatus.ARCHIVED],
  [ProjectStatus.ARCHIVED]: [ProjectStatus.CLOSED],
};

export { COURRIER_DONE };

/**
 * Projects. Each belongs to one site: seen by that site's users only, and
 * managed by that site's responsible or a platform administrator (who sees
 * every site's). Within its site, it may list the users allowed to open it
 * (ProjectAccess, see visibleProjectWhere).
 */
@Injectable()
export class ProjectService {
  constructor(
    private readonly database: DatabaseService,
    // Read by @AuditLog through `this.activity`.
    private readonly activity: ActivityService,
    private readonly rbac: RbacService,
    private readonly notifications: NotificationsService,
  ) {}

  @AuditLog({
    action: 'project.created',
    entityType: 'project',
    operation: 'CREATE',
  })
  async create(dto: CreateProjectDto, actingUserId: string) {
    const {
      startDate,
      endDate,
      maitreOuvrageName,
      siteId: requestedSiteId,
      ...data
    } = dto;
    const scope = await this.rbac.managedSites(
      actingUserId,
      PermissionCode.ProjectCreate,
    );
    assertAdministers(scope);
    let siteId = requestedSiteId;
    if (!siteId) {
      if (scope === 'ALL' || scope.length !== 1) {
        throw new BadRequestException('siteId is required');
      }
      siteId = scope[0];
    }
    await this.rbac.explainOutOfScope(
      scope,
      siteId,
      'Ce projet',
      PermissionCode.ProjectCreate,
    );
    await assertSiteExists(this.database, siteId);
    await this.assertLinks(data, undefined, siteId);
    const dates = toDates(startDate, endDate);
    assertDateOrder(dates.startDate, dates.endDate);
    return this.database.project.create({
      data: {
        ...data,
        ...dates,
        siteId,
        maitreOuvrageId: await this.maitreOuvrageId(
          data,
          maitreOuvrageName,
          siteId,
        ),
      },
      include: projectInclude,
    });
  }

  /**
   * The projects page in one call: the filtered, paginated list plus its
   * metric cards. `metrics` ignore the filters, so the cards and tab counts
   * stay put while the user searches or switches tab.
   */
  async findAll(query: FindProjectsQueryDto, userId: string) {
    const contains = query.search
      ? { contains: query.search, mode: 'insensitive' as const }
      : undefined;
    const site = await ownSiteFilter(this.rbac, this.database, userId);
    // Platform administrators: every site's, or the one asked for.
    const siteScope: Prisma.ProjectWhereInput =
      site ?? (query.siteId ? { siteId: query.siteId } : {});
    const where: Prisma.ProjectWhereInput = {
      ...siteScope,
      status: query.status,
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
      this.metrics(siteScope),
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
    return { ...project, metrics };
  }

  // Closing and archiving go through `status`; closedAt / archivedAt are
  // stamped here, never sent. `reason` only goes with archiving.
  @AuditLog({
    action: 'project.updated',
    entityType: 'project',
    operation: 'UPDATE',
    metadata: (args) => {
      const { note } = args[1] as UpdateProjectDto;
      return note ? { note } : undefined;
    },
  })
  async update(id: string, dto: UpdateProjectDto, actingUserId: string) {
    const project = await this.findOne(id);
    const {
      startDate,
      endDate,
      status,
      reason,
      note,
      maitreOuvrageName,
      ...data
    } = dto;
    const archiving =
      status !== undefined &&
      status !== project.status &&
      (status === ProjectStatus.ARCHIVED ||
        project.status === ProjectStatus.ARCHIVED);
    if (archiving) {
      await this.assertManages(
        project.siteId,
        actingUserId,
        PermissionCode.ProjectArchive,
      );
    }
    // Archiving alone needs PROJECT_ARCHIVE only.
    const changesOtherFields = Object.values({
      ...data,
      startDate,
      endDate,
      maitreOuvrageName,
    }).some((value) => value !== undefined);
    if (!archiving || changesOtherFields) {
      await this.assertManages(project.siteId, actingUserId);
    }
    await this.assertLinks(data, project, project.siteId);
    const dates = toDates(startDate, endDate);
    assertDateOrder(
      dates.startDate !== undefined ? dates.startDate : project.startDate,
      dates.endDate !== undefined ? dates.endDate : project.endDate,
    );
    const statusChanged = status !== undefined && status !== project.status;
    if (
      reason !== undefined &&
      !(statusChanged && status === ProjectStatus.ARCHIVED)
    ) {
      throw new BadRequestException('A reason only goes with archiving');
    }
    if (
      note !== undefined &&
      !(statusChanged && project.status === ProjectStatus.ARCHIVED)
    ) {
      throw new BadRequestException('A note only goes with unarchiving');
    }
    const change = statusChanged
      ? statusChange(project.status, status, reason)
      : undefined;
    const maitreOuvrageId = await this.maitreOuvrageId(
      data,
      maitreOuvrageName,
      project.siteId,
    );
    const save = (db: Prisma.TransactionClient) =>
      db.project.update({
        where: { id },
        data: { ...data, ...dates, maitreOuvrageId, ...change },
        include: projectInclude,
      });
    if (!change) return save(this.database);
    // Everything in the project follows its status, or nothing does.
    return this.database.$transaction(
      async (tx) => {
        await cascadeProjectStatus(tx, project, status!, change);
        return save(tx);
      },
      { timeout: 60_000 },
    );
  }

  @AuditLog({
    action: 'project.deleted',
    entityType: 'project',
    operation: 'DELETE',
  })
  async remove(id: string, actingUserId: string) {
    const project = await this.findOne(id);
    await this.assertManages(
      project.siteId,
      actingUserId,
      PermissionCode.ProjectArchive,
    );
    try {
      await this.database.project.delete({ where: { id } });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2003'
      ) {
        throw new BadRequestException(
          'Project is still referenced by one or more dossiers or contracts',
        );
      }
      throw error;
    }
  }

  async getAccess(id: string, userId: string) {
    await this.assertVisible(id, userId);
    return this.accessList(id);
  }

  // Replaces the list. A platform administrator or the project's
  // responsible may.
  async setAccess(id: string, userIds: string[], actingUserId: string) {
    const project = await this.findOne(id);
    if (
      project.responsibleId !== actingUserId &&
      !(await this.isAdmin(actingUserId))
    ) {
      throw new ForbiddenException(
        "Only the project's responsible or a platform administrator can change who may open it",
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
      'ALL',
    );
  }

  private accessList(projectId: string) {
    return this.database.user.findMany({
      where: { projectAccesses: { some: { projectId } } },
      select: { id: true, name: true, email: true },
      orderBy: { name: 'asc' },
    });
  }

  private isAdmin(userId: string) {
    return this.rbac.hasGlobalPermission(
      userId,
      PermissionCode.AdminManageReferentials,
    );
  }

  // Its own site's projects (open to them) — all of them for a platform
  // administrator.
  private async visibleTo(userId: string): Promise<Prisma.ProjectWhereInput> {
    const site = await ownSiteFilter(this.rbac, this.database, userId);
    return site ? { ...site, ...visibleProjectWhere(userId) } : {};
  }

  // A project is managed by its site's responsible, whoever holds the
  // permission at its site, or a platform administrator.
  private async assertManages(
    siteId: string,
    userId: string,
    permission = PermissionCode.ProjectUpdate,
  ) {
    await this.rbac.assertManagesSite(userId, permission, siteId, 'Ce projet');
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

  private async metrics(siteScope: Prisma.ProjectWhereInput) {
    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    // Weeks start on Monday.
    const startOfWeek = new Date(
      now.getFullYear(),
      now.getMonth(),
      now.getDate() - ((now.getDay() + 6) % 7),
    );
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const inProject = { project: siteScope };

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
        where: siteScope,
        _count: true,
      }),
      this.database.project.count({
        where: { ...siteScope, createdAt: { gte: startOfMonth } },
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
          ...siteScope,
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

  // The maître d'ouvrage given by name: found or created — on the
  // project's site. `undefined` keeps the one given by id, or the current
  // one.
  private async maitreOuvrageId(
    data: { maitreOuvrageId?: string },
    name: string | undefined,
    siteId: string,
  ) {
    if (name === undefined) return data.maitreOuvrageId;
    if (data.maitreOuvrageId) {
      throw new BadRequestException(
        'Give the maître d’ouvrage by id or by name, not both',
      );
    }
    return findOrCreateCorrespondent(this.database, name, siteId);
  }

  // The maître d'ouvrage must be an active correspondent and the
  // responsible an active user — checked only when they change.
  private async assertLinks(
    dto: { maitreOuvrageId?: string; responsibleId?: string },
    current:
      | { maitreOuvrageId: string | null; responsibleId: string | null }
      | undefined,
    siteId: string,
  ) {
    // The maître d'ouvrage is a correspondent of the project's site.
    if (
      dto.maitreOuvrageId &&
      dto.maitreOuvrageId !== current?.maitreOuvrageId
    ) {
      await assertCorrespondentActive(
        this.database,
        dto.maitreOuvrageId,
        siteId,
      );
    }
    if (dto.responsibleId && dto.responsibleId !== current?.responsibleId) {
      const user = await this.database.user.findUnique({
        where: { id: dto.responsibleId },
        select: { status: true },
      });
      if (!user) {
        throw new BadRequestException(`User ${dto.responsibleId} not found`);
      }
      if (user.status !== UserStatus.ACTIVE) {
        throw new BadRequestException(
          'An inactive user cannot be responsible for a project',
        );
      }
    }
  }
}

// From `today` to `days` days later, both included.
export function endingWithin(days: number, today: Date) {
  const last = new Date(today);
  last.setDate(last.getDate() + days + 1);
  return { gte: today, lt: last };
}

function statusChange(
  from: ProjectStatus,
  to: ProjectStatus,
  reason: string | undefined,
) {
  if (!NEXT_STATUSES[from].includes(to)) {
    throw new BadRequestException(
      `A project can't go from ${from} to ${to} (expected one of: ${NEXT_STATUSES[from].join(', ')})`,
    );
  }
  const now = new Date();
  switch (to) {
    case ProjectStatus.ACTIVE:
      return { status: to, closedAt: null };
    case ProjectStatus.CLOSED:
      // Unarchiving keeps the original closing date.
      return from === ProjectStatus.ARCHIVED
        ? { status: to, archivedAt: null, archiveReason: null }
        : { status: to, closedAt: now };
    case ProjectStatus.ARCHIVED:
      return { status: to, archivedAt: now, archiveReason: reason ?? null };
  }
}

// `undefined` keeps a date as is (update), a string sets it.
function toDates(startDate?: string, endDate?: string) {
  return {
    startDate: startDate !== undefined ? new Date(startDate) : undefined,
    endDate: endDate !== undefined ? new Date(endDate) : undefined,
  };
}

function assertDateOrder(
  startDate: Date | null | undefined,
  endDate: Date | null | undefined,
) {
  if (startDate && endDate && endDate < startDate) {
    throw new BadRequestException(
      "A project can't end before it starts (endDate before startDate)",
    );
  }
}
