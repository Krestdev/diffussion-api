import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  ContractStatus,
  CourrierDirection,
  CourrierStatus,
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
import { RbacService } from '../../auth/rbac/rbac.service';
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
import { overdueWhere } from '../../instructions/instruction-overdue';
import { CreateProjectDto } from './dto/create-project.dto';
import { FindProjectsQueryDto } from './dto/find-projects.query.dto';
import { UpdateProjectDto } from './dto/update-project.dto';

const projectInclude = {
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

// A courrier in one of these is done with: neither in progress nor waiting.
export const COURRIER_DONE: CourrierStatus[] = [
  CourrierStatus.CLOTURE,
  CourrierStatus.ARCHIVE,
  CourrierStatus.ANNULE,
  CourrierStatus.ENVOYE,
];

/**
 * Projects. Each may list the users allowed to open it (ProjectAccess, see
 * visibleProjectWhere); platform administrators see them all.
 */
@Injectable()
export class ProjectService {
  constructor(
    private readonly database: DatabaseService,
    // Read by @AuditLog through `this.activity`.
    private readonly activity: ActivityService,
    private readonly rbac: RbacService,
  ) {}

  @AuditLog({
    action: 'project.created',
    entityType: 'project',
    operation: 'CREATE',
  })
  async create(dto: CreateProjectDto) {
    const { startDate, endDate, maitreOuvrageName, ...data } = dto;
    await this.assertLinks(data);
    const dates = toDates(startDate, endDate);
    assertDateOrder(dates.startDate, dates.endDate);
    return this.database.project.create({
      data: {
        ...data,
        ...dates,
        maitreOuvrageId: await this.maitreOuvrageId(data, maitreOuvrageName),
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
    const where: Prisma.ProjectWhereInput = {
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
      this.metrics(),
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
  })
  async update(id: string, dto: UpdateProjectDto) {
    const project = await this.findOne(id);
    const { startDate, endDate, status, reason, maitreOuvrageName, ...data } =
      dto;
    await this.assertLinks(data, project);
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
    return this.database.project.update({
      where: { id },
      data: {
        ...data,
        ...dates,
        maitreOuvrageId: await this.maitreOuvrageId(data, maitreOuvrageName),
        ...(statusChanged ? statusChange(project.status, status, reason) : {}),
      },
      include: projectInclude,
    });
  }

  @AuditLog({
    action: 'project.deleted',
    entityType: 'project',
    operation: 'DELETE',
  })
  async remove(id: string) {
    await this.findOne(id);
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

  private async visibleTo(userId: string): Promise<Prisma.ProjectWhereInput> {
    return (await this.isAdmin(userId)) ? {} : visibleProjectWhere(userId);
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

  private async metrics() {
    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    // Weeks start on Monday.
    const startOfWeek = new Date(
      now.getFullYear(),
      now.getMonth(),
      now.getDate() - ((now.getDay() + 6) % 7),
    );
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const inProject = { projectId: { not: null } };

    const [
      byStatusRows,
      createdThisMonth,
      contracts,
      contractsEndingSoon,
      dossiers,
      dossiersCreatedThisWeek,
      withoutResponsible,
    ] = await Promise.all([
      this.database.project.groupBy({ by: ['status'], _count: true }),
      this.database.project.count({
        where: { createdAt: { gte: startOfMonth } },
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
        where: { status: ProjectStatus.ACTIVE, responsibleId: null },
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

  // The maître d'ouvrage given by name: found or created. `undefined` keeps
  // the one given by id, or the current one.
  private async maitreOuvrageId(
    data: { maitreOuvrageId?: string },
    name: string | undefined,
  ) {
    if (name === undefined) return data.maitreOuvrageId;
    if (data.maitreOuvrageId) {
      throw new BadRequestException(
        'Give the maître d’ouvrage by id or by name, not both',
      );
    }
    return findOrCreateCorrespondent(this.database, name);
  }

  // The maître d'ouvrage must be an active correspondent and the
  // responsible an active user — checked only when they change.
  private async assertLinks(
    dto: { maitreOuvrageId?: string; responsibleId?: string },
    current?: { maitreOuvrageId: string | null; responsibleId: string | null },
  ) {
    if (
      dto.maitreOuvrageId &&
      dto.maitreOuvrageId !== current?.maitreOuvrageId
    ) {
      await assertCorrespondentActive(this.database, dto.maitreOuvrageId);
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
