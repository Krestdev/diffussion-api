import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  ContractStatus,
  CourrierStatus,
  InstructionStatus,
  Livrable,
  LivrableStatus,
  NotificationCanal,
  Prisma,
  SubscriptionDecision,
  UserInstructionRole,
  UserStatus,
  ValidationDecision,
} from '../../generated/prisma/client';
import { DEFAULT_TAKE } from '../common/dto/pagination.query.dto';
import { dateRange } from '../common/utils/date-range';
import {
  livrableOrder,
  livrableValidations,
} from '../common/utils/livrable-history';
import { createWithUniqueReference } from '../common/utils/generate-reference';
import {
  assertDossierOpenForActivity,
  markDossierInProgress,
  refreshDossierProgress,
} from '../common/utils/dossier-lifecycle';
import { DatabaseService } from '../database/database.service';
import { NotificationsService } from '../notifications/notifications.service';
import { SettingsService } from '../administration/settings/settings.service';
import { FindWorkloadQueryDto } from './dto/find-workload.query.dto';
import { ActivityService } from '../activity/activity.service';
import { AssignInstructionDto } from './dto/assign-instruction.dto';
import { CreateInstructionsDto } from './dto/create-instruction.dto';
import { FindInstructionsQueryDto } from './dto/find-instructions.query.dto';
import {
  FindMyTasksQueryDto,
  TASK_TABS,
  TaskTab,
} from './dto/find-my-tasks.query.dto';
import { DeclineSubscriptionDto } from './dto/decline-subscription.dto';
import { overdueWhere, withOverdue } from './instruction-overdue';
import { RequestCorrectionsDto } from './dto/request-corrections.dto';
import { UpdateInstructionDto } from './dto/update-instruction.dto';
import { PermissionCode } from '../auth/rbac/rbac.constants';
import { RbacService } from '../auth/rbac/rbac.service';
import { visibleContractWhere } from '../common/utils/referential-access';
import { ownSiteFilter } from '../common/utils/site-referentials';
import { taskOfSite } from '../common/utils/site-where';
import { StorageService } from '../storage/storage.service';
import { DeposerLivrablesDto } from './dto/deposer-livrables.dto';

const dependencyRefSelect = { id: true, number: true, title: true } as const;

// Statuses in which submitted livrables can be decided (approved or
// rejected). A_CORRIGER included: when only some livrables were sent back
// for corrections, the other submitted ones can still be decided
// without waiting for the next submission.
const DECIDING_STATUSES: InstructionStatus[] = [
  InstructionStatus.EN_ATTENTE_VALIDATION,
  InstructionStatus.A_CORRIGER,
];

const instructionInclude = {
  assignees: { include: { user: { select: { id: true, name: true } } } },
  // Who subscribed or declined, with their motif, most recent first.
  subscriptions: {
    include: { user: { select: { id: true, name: true } } },
    orderBy: { decidedAt: 'desc' },
  },
  livrables: {
    include: { validations: livrableValidations, documents: true },
    orderBy: livrableOrder,
  },
  dossier: { select: { id: true, number: true, title: true } },
  contract: { select: { id: true, number: true, title: true } },
  courrier: { select: { id: true, number: true, subject: true } },
  // Sub-tasks (parentTask in the frontend's AddTaskDialog): the parent
  // task(s) this one depends on, and the task(s) that depend on it — a
  // plain many-to-many join, no blocking/gating logic is enforced from it.
  dependsOn: { include: { dependsOn: { select: dependencyRefSelect } } },
  dependents: { include: { instruction: { select: dependencyRefSelect } } },
} satisfies Prisma.InstructionInclude;

// Executants subscribe to a task before working on it; with none designated yet
// (a superviseur alone, or nobody), it waits for them.
function statusOnAssignment(executantIds?: string[]): InstructionStatus {
  return executantIds?.length
    ? InstructionStatus.AFFECTEE
    : InstructionStatus.A_AFFECTER;
}

function assignmentRows(dto: {
  executantIds?: string[];
  validateurId?: string;
  superviseurId?: string;
}) {
  const rows: Prisma.UserInstructionsCreateManyInstructionInput[] = [];
  for (const userId of dto.executantIds ?? []) {
    rows.push({ userId, role: UserInstructionRole.EXECUTANT });
  }
  if (dto.validateurId) {
    rows.push({
      userId: dto.validateurId,
      role: UserInstructionRole.VALIDATEUR,
    });
  }
  if (dto.superviseurId) {
    rows.push({
      userId: dto.superviseurId,
      role: UserInstructionRole.SUPERVISEUR,
    });
  }
  return rows;
}

/**
 * Who handles a task's submitted livrables: its validateur (optional) gives
 * their opinion first (AVIS, Livrable.validationStep 0 -> 1); its
 * superviseur then decides — conforme, or corrections (validationStep 1, or
 * from 0 when there is no validateur). A task without a superviseur is
 * decided by its creator. Corrected, a livrable starts again from the
 * validateur.
 */
export function validationChain(instruction: {
  createdById: string | null;
  assignees: { role: UserInstructionRole; user: { id: string } }[];
}) {
  const of = (role: UserInstructionRole) =>
    instruction.assignees.find((assignee) => assignee.role === role)?.user.id;
  return {
    validateur: of(UserInstructionRole.VALIDATEUR),
    decider: of(UserInstructionRole.SUPERVISEUR) ?? instruction.createdById,
  };
}

// Waiting for the validateur's opinion, not yet for a decision.
function awaitsAvis(
  chain: ReturnType<typeof validationChain>,
  livrable: { validationStep: number },
) {
  return Boolean(chain.validateur) && livrable.validationStep === 0;
}

// Only the superviseur decides, and only once the validateur gave their
// opinion (when the task has one).
function assertDecider(
  instruction: Parameters<typeof validationChain>[0],
  livrables: { title: string; validationStep: number }[],
  userId: string,
) {
  const chain = validationChain(instruction);
  if (chain.decider !== userId) {
    throw new ForbiddenException(
      chain.validateur === userId
        ? 'The validateur gives their opinion (PATCH /deliverables/:id/avis): only the superviseur decides'
        : "Only this task's superviseur decides on its livrables",
    );
  }
  const waiting = livrables.filter((livrable) => awaitsAvis(chain, livrable));
  if (waiting.length) {
    throw new ForbiddenException(
      `Awaiting the validateur's opinion: ${waiting.map((l) => l.title).join(', ')}`,
    );
  }
}

// The validateur judges the executants' work: never one of them.
function assertValidateurApart(
  validateurId: string | undefined,
  executantIds: string[] | undefined,
) {
  if (validateurId && executantIds?.includes(validateurId)) {
    throw new BadRequestException(
      'The validateur cannot be one of the executants',
    );
  }
}

// Work has started: changing the request now opens a new cycle (H12).
const WORK_STARTED: InstructionStatus[] = [
  InstructionStatus.EN_COURS,
  InstructionStatus.EN_ATTENTE_VALIDATION,
  InstructionStatus.A_CORRIGER,
];

function toDate(value: string | undefined): Date | null {
  return value ? new Date(value) : null;
}

function sameDate(a: Date | null, b: Date | null) {
  return (a?.getTime() ?? null) === (b?.getTime() ?? null);
}

// The executants hand their livrables in before the task has to be
// validated.
function assertDeadlines(dueDate: Date | null, agentDueDate: Date | null) {
  if (dueDate && agentDueDate && agentDueDate > dueDate) {
    throw new BadRequestException(
      "The executants' deadline (agentDueDate) can't be after the task's deadline (dueDate)",
    );
  }
}

// An agent's instructions in progress: assigned to them as executant and
// not settled yet.
const ACTIVE_INSTRUCTION_STATUSES: InstructionStatus[] = [
  InstructionStatus.AFFECTEE,
  InstructionStatus.ACCEPTEE,
  InstructionStatus.EN_COURS,
  InstructionStatus.EN_ATTENTE_VALIDATION,
  InstructionStatus.A_CORRIGER,
];

// The executants owe something: not subscribed yet, at work, or correcting.
const REMINDABLE_STATUSES: InstructionStatus[] = [
  InstructionStatus.AFFECTEE,
  InstructionStatus.EN_COURS,
  InstructionStatus.A_CORRIGER,
];

// At most one reminder per task in this window.
const REMIND_INTERVAL_MS = 60 * 60 * 1000;

@Injectable()
export class InstructionsService {
  constructor(
    private readonly database: DatabaseService,
    private readonly notifications: NotificationsService,
    private readonly activity: ActivityService,
    private readonly storage: StorageService,
    private readonly rbac: RbacService,
    private readonly settings: SettingsService,
  ) {}

  /**
   * Reminds the executants of a task: by its superviseur, else its creator,
   * or a platform administrator. Once an hour at most.
   */
  async remind(id: string, userId: string) {
    const instruction = await this.requireStatus(id, REMINDABLE_STATUSES);
    const superviseurs = instruction.assignees
      .filter((assignee) => assignee.role === UserInstructionRole.SUPERVISEUR)
      .map((assignee) => assignee.user.id);
    const allowed =
      superviseurs.includes(userId) ||
      instruction.createdById === userId ||
      (await this.rbac.hasGlobalPermission(
        userId,
        PermissionCode.AdminManageUsers,
      ));
    if (!allowed) {
      throw new ForbiddenException(
        "Only this task's superviseur, its creator or a platform administrator can remind its executants",
      );
    }
    const executants = instruction.assignees
      .filter((assignee) => assignee.role === UserInstructionRole.EXECUTANT)
      .map((assignee) => assignee.user.id);
    if (executants.length === 0) {
      throw new BadRequestException('This task has no executant to remind');
    }

    const now = new Date();
    const { count } = await this.database.instruction.updateMany({
      where: {
        id,
        OR: [
          { lastRemindedAt: null },
          {
            lastRemindedAt: {
              lt: new Date(now.getTime() - REMIND_INTERVAL_MS),
            },
          },
        ],
      },
      data: { lastRemindedAt: now },
    });
    if (count === 0) {
      throw new ConflictException(
        'Its executants were reminded less than an hour ago',
      );
    }
    this.notifyInstruction(
      instruction,
      executants,
      {
        type: 'TASK_REMINDER',
        message: `Relance : la tâche « ${instruction.title} » attend votre action.`,
      },
      userId,
    );
    void this.activity
      .tryRecord({
        action: 'INSTRUCTION_RELANCEE',
        entityType: 'Instruction',
        entityId: id,
        metadata: { executantIds: executants },
      })
      .catch(() => undefined);
    return { id, remindedAt: now, executantIds: executants };
  }

  /**
   * Instructions in progress per agent, on the sites where the caller may
   * assign tasks, with the capacity set in the settings.
   */
  async workload(query: FindWorkloadQueryDto, userId: string) {
    const sites = await this.rbac.siteFilter(
      userId,
      PermissionCode.InstructionAssign,
      (siteId): Prisma.UserWhereInput => ({ siteId }),
    );
    const [agents, counts] = await Promise.all([
      this.database.user.findMany({
        where: {
          AND: [sites, query.siteId ? { siteId: query.siteId } : {}],
          status: UserStatus.ACTIVE,
        },
        select: { id: true, name: true, email: true, siteId: true },
        orderBy: { name: 'asc' },
      }),
      this.database.userInstructions.groupBy({
        by: ['userId'],
        where: {
          role: UserInstructionRole.EXECUTANT,
          instruction: { status: { in: ACTIVE_INSTRUCTION_STATUSES } },
        },
        _count: { _all: true },
      }),
    ]);
    const inProgress = new Map(
      counts.map((row) => [row.userId, row._count._all]),
    );
    // Each agent's capacity is their site's setting.
    const siteIds = [...new Set(agents.map((agent) => agent.siteId))];
    const capacities = new Map(
      await Promise.all(
        siteIds.map(
          async (siteId) =>
            [
              siteId,
              (await this.settings.get(siteId)).maxActiveInstructionsPerAgent,
            ] as const,
        ),
      ),
    );
    const capacity =
      query.siteId !== undefined
        ? (capacities.get(query.siteId) ??
          (await this.settings.get(query.siteId)).maxActiveInstructionsPerAgent)
        : siteIds.length === 1
          ? (capacities.get(siteIds[0]) ?? null)
          : null;
    const data = agents
      .map((agent) => {
        const active = inProgress.get(agent.id) ?? 0;
        const capacity = capacities.get(agent.siteId) ?? null;
        return {
          user: agent,
          inProgress: active,
          capacity,
          overCapacity: capacity !== null && active >= capacity,
        };
      })
      .sort((a, b) => b.inProgress - a.inProgress);
    return { data, capacity };
  }

  /**
   * Who may prepare, edit or remove a task's livrables: the executant who
   * subscribed to it — that engagement is their right to work on it,
   * whatever their role — or anyone holding every one of `permissions` at
   * the task's site. Depositing and submitting are the subscriber's alone
   * (assertSubscriber).
   */
  async assertMayWorkOn(
    instructionId: string,
    userId: string,
    permissions: PermissionCode[],
  ) {
    const instruction = await this.database.instruction.findUnique({
      where: { id: instructionId },
      select: { dossier: { select: { siteId: true } } },
    });
    if (!instruction) {
      throw new NotFoundException(`Instruction ${instructionId} not found`);
    }
    if (await this.isSubscriber(instructionId, userId)) {
      return;
    }
    const siteId = instruction.dossier?.siteId;
    for (const permission of permissions) {
      const granted = siteId
        ? await this.rbac.hasPermissionAtSite(userId, permission, siteId)
        : await this.rbac.hasPermission(userId, permission);
      if (!granted) {
        throw new ForbiddenException(
          `Missing permission${siteId ? ' at this site' : ''}: ${permission} — or be an executant of this task once subscribed to`,
        );
      }
    }
  }

  /**
   * Only the executant who subscribed to a task hands its livrables in
   * (deposit, submit) — and, after corrections, hands them in again. Its
   * other executants and permission holders don't.
   */
  async assertSubscriber(instructionId: string, userId: string) {
    if (!(await this.isSubscriber(instructionId, userId))) {
      throw new ForbiddenException(
        'Only the executant who subscribed to this task can hand its livrables in',
      );
    }
  }

  // Subscribed to the task, and still one of its executants (one taken off
  // it by a reassignment no longer is).
  private async isSubscriber(instructionId: string, userId: string) {
    const count = await this.database.instruction.count({
      where: {
        id: instructionId,
        assignees: { some: { userId, role: UserInstructionRole.EXECUTANT } },
        subscriptions: {
          some: { userId, decision: SubscriptionDecision.SOUSCRITE },
        },
      },
    });
    return count > 0;
  }

  // A task under a contract (no dossier): the contract must exist, be
  // active, and be one its creator may open — contracts have no site, so
  // this stands in for the dossier's site check.
  private async assertContractOpenTo(contractId: string, userId: string) {
    const contract = await this.database.contract.findUnique({
      where: { id: contractId },
      select: { number: true, status: true },
    });
    if (!contract) {
      throw new BadRequestException(`Contract ${contractId} not found`);
    }
    if (contract.status === ContractStatus.ARCHIVED) {
      throw new BadRequestException(
        `Contract ${contract.number} is archived — no task can be added to it`,
      );
    }
    const isAdmin = await this.rbac.hasGlobalPermission(
      userId,
      PermissionCode.AdminManageReferentials,
    );
    const visible =
      isAdmin ||
      (await this.database.contract.count({
        where: { id: contractId, ...visibleContractWhere(userId) },
      })) > 0;
    if (!visible) {
      throw new ForbiddenException(
        `You may not open contract ${contract.number}`,
      );
    }
  }

  private recordEvent(
    id: string,
    action: string,
    metadata?: Record<string, unknown>,
    message?: string,
  ) {
    this.activity
      .tryRecord({
        action,
        entityType: 'Instruction',
        entityId: id,
        metadata,
        message,
      })
      .catch(() => undefined);
  }

  private notifyInstruction(
    instruction: {
      id: string;
      dossierId: string | null;
      courrierId: string | null;
    },
    userIds: (string | null | undefined)[],
    event: { type: string; message: string },
    excludeUserId?: string,
  ) {
    const recipientIds = [
      ...new Set(
        userIds.filter(
          (id): id is string => Boolean(id) && id !== excludeUserId,
        ),
      ),
    ];
    if (recipientIds.length === 0) return;
    // Fire-and-forget: a notification failing to write must never fail the
    // instruction change it's about.
    this.notifications
      .create({
        recipientIds,
        type: event.type,
        message: event.message,
        canal: NotificationCanal.IN_APP,
        dossierId: instruction.dossierId ?? undefined,
        courrierId: instruction.courrierId ?? undefined,
        instructionId: instruction.id,
      })
      .catch((error: unknown) => {
        console.error('Failed to create instruction notification', error);
      });
  }

  private notifyAssignment(
    instruction: {
      id: string;
      title: string;
      dossierId: string | null;
      courrierId: string | null;
    },
    userIds: (string | null | undefined)[],
    excludeUserId?: string,
  ) {
    this.notifyInstruction(
      instruction,
      userIds,
      {
        type: 'TASK_ASSIGNED',
        message: `La tâche « ${instruction.title} » vous a été assignée.`,
      },
      excludeUserId,
    );
  }

  async create(dto: CreateInstructionsDto, createdById: string) {
    const {
      executantIds,
      superviseurId,
      validateurId,
      dueDate,
      agentDueDate,
      dependsOnId,
      livrables,
      ...data
    } = dto;
    assertValidateurApart(validateurId, executantIds);

    if (!data.dossierId && !data.contractId) {
      throw new BadRequestException('Provide either dossierId or contractId');
    }
    if (data.dossierId && data.contractId) {
      throw new BadRequestException(
        'Provide either dossierId or contractId, not both',
      );
    }

    assertDeadlines(toDate(dueDate), toDate(agentDueDate));
    if (data.dossierId) {
      await assertDossierOpenForActivity(this.database, data.dossierId);
    }
    if (data.contractId) {
      await this.assertContractOpenTo(data.contractId, createdById);
    }

    // No superviseur named: the effet's supervisor, when it has one.
    let superviseur = superviseurId;
    if (!superviseur && data.courrierId) {
      const courrier = await this.database.courrier.findUnique({
        where: { id: data.courrierId },
        select: { supervisorId: true },
      });
      superviseur = courrier?.supervisorId ?? undefined;
    }

    if (dependsOnId) {
      const parent = await this.database.instruction.findUnique({
        where: { id: dependsOnId },
      });
      if (!parent) {
        throw new NotFoundException(`Instruction ${dependsOnId} not found`);
      }
    }

    const instruction = await createWithUniqueReference('T', (number) =>
      this.database.instruction.create({
        data: {
          ...data,
          number,
          dueDate: dueDate ? new Date(dueDate) : undefined,
          agentDueDate: agentDueDate ? new Date(agentDueDate) : undefined,
          createdById,
          // Assigned executants subscribe to it before working on it
          // (subscribe());
          // without one yet, a superviseur still has to designate them.
          status: statusOnAssignment(executantIds),
          assignedAt: executantIds?.length || superviseur ? new Date() : null,
          assignees: {
            createMany: {
              data: assignmentRows({
                executantIds,
                validateurId,
                superviseurId: superviseur,
              }),
            },
          },
          // Sub-tasks: a single parent picked at creation (the frontend's
          // AddTaskDialog exposes one "Tâche parent" field) — the schema
          // itself allows several, this just doesn't expose that yet.
          dependsOn: dependsOnId ? { create: { dependsOnId } } : undefined,
          livrables: livrables?.length
            ? {
                createMany: {
                  data: livrables.map((l, position) => ({
                    position,
                    title: l.title,
                    description: l.description,
                    createdById,
                  })),
                },
              }
            : undefined,
        },
        include: instructionInclude,
      }),
    );

    const assigneeIds = [
      ...new Set(
        [...(executantIds ?? []), validateurId, superviseur].filter(
          (userId): userId is string => Boolean(userId),
        ),
      ),
    ];
    await this.ensureViewAccess(assigneeIds, {
      dossierId: instruction.dossierId,
      courrierId: instruction.courrierId,
    });
    this.notifyAssignment(instruction, assigneeIds, createdById);

    if (instruction.dossierId) {
      await markDossierInProgress(this.database, instruction.dossierId);
      await refreshDossierProgress(this.database, instruction.dossierId);
    }
    this.recordEvent(instruction.id, 'INSTRUCTION_CREEE');
    return instruction;
  }

  async findAll(query: FindInstructionsQueryDto, userId: string) {
    const ownSite = await ownSiteFilter(this.rbac, this.database, userId);
    const where: Prisma.InstructionWhereInput = {
      AND: [
        ownSite ? taskOfSite(ownSite.siteId) : {},
        query.siteId ? taskOfSite(query.siteId) : {},
      ],
      dossierId: query.dossierId,
      courrierId: query.courrierId,
      status: query.status,
      assignees: query.assigneeId
        ? { some: { userId: query.assigneeId } }
        : undefined,
      ...(query.overdue ? overdueWhere(new Date()) : {}),
    };

    const [data, total] = await this.database.$transaction([
      this.database.instruction.findMany({
        where,
        include: instructionInclude,
        orderBy: { createdAt: 'desc' },
        skip: query.skip ?? 0,
        take: query.take ?? 20,
      }),
      this.database.instruction.count({ where }),
    ]);

    const now = new Date();
    return {
      data: data.map((instruction) => withOverdue(instruction, now)),
      total,
      skip: query.skip ?? 0,
      take: query.take ?? 20,
    };
  }

  /**
   * Everything the "Tâches" page needs in one call: the caller's tasks in
   * one tab (see TASK_TABS), filtered and paginated server-side, plus each
   * tab's count. "Mine" = I'm an assignee (executant or superviseur, or
   * just one of them with `role`). `metrics` ignore the filters, so the
   * tab counts stay put while the user searches.
   */
  async findMyTasks(query: FindMyTasksQueryDto, userId: string) {
    const skip = query.skip ?? 0;
    const take = query.take ?? DEFAULT_TAKE;
    const tab = query.tab ?? 'en-cours';
    const mine: Prisma.InstructionWhereInput = {
      assignees: { some: { userId, role: query.role } },
    };
    // Once subscribed to, a task is its subscriber's: a co-executant who
    // didn't subscribe no longer sees it in progress or done. Its validateur
    // and superviseur still do.
    const subscribed: Prisma.InstructionWhereInput = {
      assignees: { some: { userId, role: UserInstructionRole.EXECUTANT } },
      subscriptions: {
        some: { userId, decision: SubscriptionDecision.SOUSCRITE },
      },
    };
    const takingPart: Prisma.InstructionWhereInput =
      query.role === UserInstructionRole.EXECUTANT
        ? subscribed
        : query.role
          ? mine
          : {
              OR: [
                {
                  assignees: {
                    some: {
                      userId,
                      role: { not: UserInstructionRole.EXECUTANT },
                    },
                  },
                },
                subscribed,
              ],
            };
    // "Renvoyées": tasks no executant subscribed to come back to their
    // superviseur, or to their creator when they have none.
    // "all" ignores the status filter entirely.
    const sentBack: Prisma.InstructionWhereInput = {
      OR: [
        {
          assignees: {
            some: { userId, role: UserInstructionRole.SUPERVISEUR },
          },
        },
        {
          createdById: userId,
          assignees: { none: { role: UserInstructionRole.SUPERVISEUR } },
        },
      ],
    };
    const inTab = (name: TaskTab): Prisma.InstructionWhereInput => {
      const statuses = TASK_TABS[name];
      return {
        ...(name === 'renvoyees'
          ? sentBack
          : name === 'en-cours' || name === 'terminees'
            ? takingPart
            : mine),
        ...(statuses ? { status: { in: [...statuses] } } : {}),
      };
    };

    const contains = query.search
      ? { contains: query.search, mode: 'insensitive' as const }
      : undefined;
    const where: Prisma.InstructionWhereInput = {
      AND: [
        inTab(tab),
        {
          status: query.status,
          priority: query.priority,
          dossierId: query.dossierId,
          contractId: query.contractId,
          ...(query.overdue ? overdueWhere(new Date()) : {}),
          createdAt: dateRange(query.createdFrom, query.createdTo),
        },
        ...(contains
          ? [
              {
                OR: [
                  { number: contains },
                  { title: contains },
                  { dossier: { number: contains } },
                  { dossier: { title: contains } },
                ],
              },
            ]
          : []),
      ],
    };

    // aSubscrire: tasks in AFFECTEE where I am executant with no subscription decision yet.
    const aSubscrireWhere: Prisma.InstructionWhereInput = {
      status: InstructionStatus.AFFECTEE,
      assignees: { some: { userId, role: UserInstructionRole.EXECUTANT } },
      subscriptions: { none: { userId } },
    };

    // Submitted livrables waiting on me: my opinion as validateur (step 0),
    // my decision as superviseur (step 1, or from 0 without a validateur).
    const submitted = { status: LivrableStatus.SOUMIS, isLatest: true };
    const avisWhere: Prisma.LivrableWhereInput = {
      ...submitted,
      validationStep: 0,
      instruction: {
        assignees: {
          some: { userId, role: UserInstructionRole.VALIDATEUR },
        },
      },
    };
    const toDecideWhere: Prisma.LivrableWhereInput = {
      ...submitted,
      instruction: {
        assignees: {
          some: { userId, role: UserInstructionRole.SUPERVISEUR },
        },
      },
      OR: [
        { validationStep: { gte: 1 } },
        {
          instruction: {
            assignees: { none: { role: UserInstructionRole.VALIDATEUR } },
          },
        },
      ],
    };

    const [
      data,
      total,
      inProgress,
      completed,
      returned,
      aSubscrire,
      avisAttendus,
      aValider,
    ] = await this.database.$transaction([
      this.database.instruction.findMany({
        where,
        include: instructionInclude,
        orderBy: { createdAt: 'desc' },
        skip,
        take,
      }),
      this.database.instruction.count({ where }),
      this.database.instruction.count({ where: inTab('en-cours') }),
      this.database.instruction.count({ where: inTab('terminees') }),
      this.database.instruction.count({ where: inTab('renvoyees') }),
      this.database.instruction.count({ where: aSubscrireWhere }),
      this.database.livrable.count({ where: avisWhere }),
      this.database.livrable.count({ where: toDecideWhere }),
    ]);

    const now = new Date();
    return {
      data: data.map((instruction) => withOverdue(instruction, now)),
      total,
      skip,
      take,
      // avisAttendus: livrables awaiting my opinion as validateur;
      // aValider: livrables awaiting my decision as superviseur.
      metrics: {
        inProgress,
        completed,
        returned,
        aSubscrire,
        avisAttendus,
        aValider,
      },
    };
  }

  async findOne(id: string) {
    const instruction = await this.database.instruction.findUnique({
      where: { id },
      include: instructionInclude,
    });
    if (!instruction) {
      throw new NotFoundException(`Instruction ${id} not found`);
    }
    return withOverdue(instruction);
  }

  // Its site's users, whoever it is assigned to or was created by, and the
  // platform's administrators. Anyone else: as if it didn't exist.
  async assertVisible(id: string, userId: string) {
    const ownSite = await ownSiteFilter(this.rbac, this.database, userId);
    if (!ownSite) return;
    const visible = await this.database.instruction.count({
      where: {
        id,
        OR: [
          taskOfSite(ownSite.siteId),
          { createdById: userId },
          { assignees: { some: { userId } } },
        ],
      },
    });
    if (!visible) throw new NotFoundException(`Instruction ${id} not found`);
  }

  async historique(id: string, skip = 0, take = 20) {
    await this.findOne(id); // 404 if not found
    const where = { entityId: id, entityType: 'Instruction' };
    const [data, total] = await this.database.$transaction([
      this.database.activityLog.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take,
      }),
      this.database.activityLog.count({ where }),
    ]);
    return { data, total, skip, take };
  }

  // RG-INS-005: mutable as long as the dossier is not closed. The dossier
  // being closed already implies every one of its instructions is terminal,
  // so it's enough to just refuse edits on a terminal instruction here.
  // H12: changing what is asked once work has started opens a new cycle;
  // corrections within the request never do (they keep the cycle and the
  // deadlines). A moved deadline gets its overdue alert again.
  async update(id: string, dto: UpdateInstructionDto) {
    const instruction = await this.ensureNotTerminal(id);
    const { dueDate, agentDueDate, ...data } = dto;
    const nextDue =
      dueDate !== undefined ? new Date(dueDate) : instruction.dueDate;
    const nextAgentDue =
      agentDueDate !== undefined
        ? new Date(agentDueDate)
        : instruction.agentDueDate;
    assertDeadlines(nextDue, nextAgentDue);

    const requestChanged =
      (dto.title !== undefined && dto.title !== instruction.title) ||
      (dto.description !== undefined &&
        dto.description !== instruction.description);
    const newCycle =
      requestChanged && WORK_STARTED.includes(instruction.status);

    const updated = await this.database.instruction.update({
      where: { id: instruction.id },
      data: {
        ...data,
        dueDate: dueDate ? new Date(dueDate) : undefined,
        agentDueDate: agentDueDate ? new Date(agentDueDate) : undefined,
        ...(sameDate(nextDue, instruction.dueDate)
          ? {}
          : {
              overdueNotifiedAt: null,
              // PA·8 reminders start over with the new deadline.
              dueReminderSentAt: null,
              overdueRemindedAt: null,
            }),
        agentOverdueNotifiedAt: sameDate(nextAgentDue, instruction.agentDueDate)
          ? undefined
          : null,
        cycle: newCycle ? { increment: 1 } : undefined,
      },
      include: instructionInclude,
    });
    return withOverdue(updated);
  }

  // The executants' deadline, set by the task's superviseur — or its
  // creator when it has none. By designation.
  async setAgentDueDate(id: string, agentDueDate: string, userId: string) {
    const instruction = await this.ensureNotTerminal(id);
    const superviseurs = instruction.assignees.filter(
      (assignee) => assignee.role === UserInstructionRole.SUPERVISEUR,
    );
    // The validateur only gives opinions: never the deadline.
    const isValidateur = instruction.assignees.some(
      (assignee) =>
        assignee.role === UserInstructionRole.VALIDATEUR &&
        assignee.user.id === userId,
    );
    const allowed =
      !isValidateur &&
      (superviseurs.length
        ? superviseurs.some((assignee) => assignee.user.id === userId)
        : instruction.createdById === userId);
    if (!allowed) {
      throw new ForbiddenException(
        superviseurs.length
          ? "Only this task's superviseur sets its executants' deadline"
          : "Only this task's creator sets its executants' deadline",
      );
    }
    const date = new Date(agentDueDate);
    assertDeadlines(instruction.dueDate, date);
    const updated = await this.database.instruction.update({
      where: { id },
      data: {
        agentDueDate: date,
        agentOverdueNotifiedAt: sameDate(date, instruction.agentDueDate)
          ? undefined
          : null,
      },
      include: instructionInclude,
    });
    this.notifyInstruction(
      updated,
      updated.assignees
        .filter((assignee) => assignee.role === UserInstructionRole.EXECUTANT)
        .map((assignee) => assignee.user.id),
      {
        type: 'TASK_AGENT_DUE_DATE_SET',
        message: `Date limite d'exécution de la tâche « ${updated.title} » : ${date.toLocaleDateString('fr-FR')}.`,
      },
      userId,
    );
    return withOverdue(updated);
  }

  // RG-INS-002: (re)assign directly to executant(s), or to a superviseur
  // responsible for designating them.
  async assign(id: string, dto: AssignInstructionDto) {
    const instruction = await this.ensureNotTerminal(id);
    if (!dto.executantIds?.length && !dto.superviseurId && !dto.validateurId) {
      throw new BadRequestException(
        'Provide at least one executant, a superviseur or a validateur',
      );
    }

    // Merge: keep existing roles not explicitly mentioned in this call.
    // Sending only executantIds keeps the validateur and the superviseur,
    // and vice-versa.
    const current = (role: UserInstructionRole) =>
      (instruction.assignees ?? []).find((assignee) => assignee.role === role)
        ?.user.id;
    const mergedDto = {
      executantIds: dto.executantIds,
      validateurId: dto.validateurId ?? current(UserInstructionRole.VALIDATEUR),
      superviseurId:
        dto.superviseurId ?? current(UserInstructionRole.SUPERVISEUR),
    };
    assertValidateurApart(mergedDto.validateurId, mergedDto.executantIds);

    const updated = await this.database.$transaction(async (tx) => {
      // A different chain decides from its first link: livrables awaiting
      // a decision start again from it.
      await tx.livrable.updateMany({
        where: { instructionId: instruction.id, status: LivrableStatus.SOUMIS },
        data: { validationStep: 0 },
      });
      return tx.instruction.update({
        where: { id: instruction.id },
        data: {
          status: statusOnAssignment(mergedDto.executantIds),
          assignedAt: instruction.assignedAt ?? new Date(),
          assignNote: dto.note ?? undefined,
          assignees: {
            deleteMany: {},
            createMany: { data: assignmentRows(mergedDto) },
          },
        },
        include: instructionInclude,
      });
    });

    const assigneeIds = [
      ...new Set(
        [
          ...(mergedDto.executantIds ?? []),
          mergedDto.validateurId,
          mergedDto.superviseurId,
        ].filter((userId): userId is string => Boolean(userId)),
      ),
    ];
    await this.ensureViewAccess(assigneeIds, {
      dossierId: instruction.dossierId,
      courrierId: instruction.courrierId,
    });
    this.notifyAssignment(updated, assigneeIds);
    this.recordEvent(id, 'INSTRUCTION_REAFFECTEE');
    return updated;
  }

  // RG-INS-003/004: an executant doesn't subscribe, with a motif, and
  // leaves the task — which they never modify. The other executants keep
  // it; with none left it goes back (NON_SOUSCRITE) to its superviseur —
  // to its creator when it has none — who reassigns or adjusts it. Only before subscribing: once subscribed, the
  // task is an engagement, raised with its creator instead. By designation:
  // only one of its executants may decline it.
  async declineSubscription(
    id: string,
    dto: DeclineSubscriptionDto,
    userId: string,
  ) {
    const instruction = await this.requireStatus(id, [
      InstructionStatus.AFFECTEE,
    ]);
    const executants = instruction.assignees.filter(
      (assignee) => assignee.role === UserInstructionRole.EXECUTANT,
    );
    const decliner = executants.find((assignee) => assignee.user.id === userId);
    if (!decliner) {
      throw new ForbiddenException(
        'Only an executant of this task can decline it',
      );
    }
    const othersLeft = executants.length - 1;

    await this.database.$transaction(async (tx) => {
      await tx.userInstructions.delete({
        where: {
          userId_instructionId_role: {
            userId,
            instructionId: id,
            role: UserInstructionRole.EXECUTANT,
          },
        },
      });
      await tx.instructionSubscription.create({
        data: {
          instructionId: id,
          userId,
          decision: SubscriptionDecision.NON_SOUSCRITE,
          motif: dto.motif,
        },
      });
      if (othersLeft === 0) {
        // Guarded on the status read above: someone subscribing meanwhile
        // keeps the task where it is.
        const { count } = await tx.instruction.updateMany({
          where: { id, status: InstructionStatus.AFFECTEE },
          data: { status: InstructionStatus.NON_SOUSCRITE },
        });
        if (count === 0) {
          throw new ConflictException(
            'This task changed meanwhile — refresh and try again',
          );
        }
      }
    });

    const updated = await this.findOne(id);
    const superviseurs = updated.assignees
      .filter((assignee) => assignee.role === UserInstructionRole.SUPERVISEUR)
      .map((assignee) => assignee.user.id);
    this.notifyInstruction(
      updated,
      superviseurs.length ? superviseurs : [updated.createdById],
      {
        type: 'TASK_NOT_SUBSCRIBED',
        message:
          `${decliner.user.name} ne souscrit pas à la tâche « ${updated.title} » : ${dto.motif}` +
          (othersLeft === 0
            ? ' Plus aucun exécutant : elle vous revient pour réaffectation.'
            : ''),
      },
      userId,
    );
    this.recordEvent(id, 'INSTRUCTION_NON_SOUSCRITE', { userId });
    return updated;
  }

  // AFFECTEE -> EN_COURS: an executant of the task subscribes to it. By
  // designation — being one of its executants is what allows it.
  async subscribe(id: string, userId: string) {
    const instruction = await this.requireStatus(id, [
      InstructionStatus.AFFECTEE,
    ]);
    const isExecutant = instruction.assignees.some(
      (assignee) =>
        assignee.user.id === userId &&
        assignee.role === UserInstructionRole.EXECUTANT,
    );
    if (!isExecutant) {
      throw new ForbiddenException(
        'Only an executant of this task can subscribe to it',
      );
    }
    // Guarded on the status read above: two executants subscribing at once
    // move it only once.
    await this.database.$transaction(async (tx) => {
      const { count } = await tx.instruction.updateMany({
        where: { id, status: InstructionStatus.AFFECTEE },
        data: { status: InstructionStatus.EN_COURS },
      });
      if (count === 0) {
        throw new ConflictException(
          'Someone subscribed to this task meanwhile — refresh and try again',
        );
      }
      await tx.instructionSubscription.create({
        data: {
          instructionId: id,
          userId,
          decision: SubscriptionDecision.SOUSCRITE,
        },
      });
      // The first executant at work on a task of an effet puts that effet
      // "En traitement" (only from TRANSMIS: once is enough).
      if (instruction.courrierId) {
        const { count: started } = await tx.courrier.updateMany({
          where: {
            id: instruction.courrierId,
            status: CourrierStatus.TRANSMIS,
          },
          data: { status: CourrierStatus.EN_TRAITEMENT },
        });
        if (started) {
          await this.activity.tryRecord({
            action: 'COURRIER_EN_TRAITEMENT',
            entityType: 'Courrier',
            entityId: instruction.courrierId,
            metadata: { instructionId: id, userId },
          });
        }
      }
    });
    const subscribed = await this.findOne(id);
    const subscriber = instruction.assignees.find(
      (assignee) => assignee.user.id === userId,
    )?.user.name;
    this.notifyInstruction(
      subscribed,
      [
        subscribed.createdById,
        ...subscribed.assignees
          .filter(
            (assignee) => assignee.role === UserInstructionRole.SUPERVISEUR,
          )
          .map((assignee) => assignee.user.id),
      ],
      {
        type: 'TASK_SUBSCRIBED',
        message: `${subscriber ?? 'Un exécutant'} a souscrit à la tâche « ${subscribed.title} ».`,
      },
      userId,
    );
    this.recordEvent(id, 'INSTRUCTION_SOUSCRITE', { userId });
    return subscribed;
  }

  // 10.4.4.7: closing requires every livrable attached to the instruction to
  // already be VALIDE (RG-LIV-005 — validation is pronounced on the
  // instruction as a whole, so this is the gate for that pronouncement).
  async close(id: string, comment?: string) {
    const instruction = await this.requireStatus(id, [
      InstructionStatus.EN_COURS,
      InstructionStatus.A_CORRIGER,
      InstructionStatus.EN_ATTENTE_VALIDATION,
    ]);

    // Current versions only: a rejected version replaced by a validated
    // one is history, not an outstanding livrable.
    const outstanding = await this.database.livrable.count({
      where: {
        instructionId: instruction.id,
        isLatest: true,
        status: { not: LivrableStatus.VALIDE },
      },
    });
    if (outstanding > 0) {
      throw new BadRequestException(
        `${outstanding} livrable(s) are not yet validated`,
      );
    }

    const closed = await this.database.instruction.update({
      where: { id: instruction.id },
      data: {
        status: InstructionStatus.TERMINEE,
        closedAt: new Date(),
        closingComment: comment ?? undefined,
      },
      include: instructionInclude,
    });
    if (closed.dossierId) {
      await refreshDossierProgress(this.database, closed.dossierId);
    }
    this.recordEvent(id, 'INSTRUCTION_TERMINEE');
    return closed;
  }

  async cancel(id: string, reason?: string) {
    const instruction = await this.ensureNotTerminal(id);
    const cancelled = await this.database.instruction.update({
      where: { id: instruction.id },
      data: {
        status: InstructionStatus.ANNULEE,
        cancellationReason: reason ?? undefined,
      },
      include: instructionInclude,
    });
    if (cancelled.dossierId) {
      await refreshDossierProgress(this.database, cancelled.dossierId);
    }
    this.recordEvent(id, 'INSTRUCTION_ANNULEE', { reason });
    return cancelled;
  }

  // 10.4.4.6 "Contrôle par le superviseur" — the approving half, by the
  // link of the validation chain whose turn it is (validationChain): the
  // livrables move on to the next link, or to VALIDE after the last one.
  // Once every current version is validated the instruction closes itself
  // (TERMINEE), and if livrables rejected one by one earlier in the round
  // are still open it goes back for corrections instead (see
  // settleValidationRound). Without a list: every submitted livrable
  // awaiting the caller.
  async approveLivrables(id: string, validatorId: string) {
    return this.approve(id, undefined, validatorId);
  }

  // Same, for a selection of the submitted livrables only; the others stay
  // SOUMIS.
  async approveSelectedLivrables(
    id: string,
    livrableIds: string[],
    validatorId: string,
  ) {
    if (!livrableIds || livrableIds.length === 0) {
      throw new BadRequestException(
        'Provide at least one livrable ID to approve',
      );
    }
    return this.approve(id, livrableIds, validatorId);
  }

  // 10.4.4.6, rejection branch, by the link whose turn it is: the listed
  // submitted livrables go to REJETE, each with its own motif (a Validation
  // row), and the instruction moves to A_CORRIGER for the executant to
  // address them — corrected, they start again from the validateur. Submitted livrables
  // not listed stay SOUMIS. `refusalReason` keeps a readable summary for
  // the task view (it is shared with the instruction refusal path).
  async requestCorrections(
    id: string,
    dto: RequestCorrectionsDto,
    validatorId: string,
  ) {
    const instruction = await this.requireStatus(id, DECIDING_STATUSES);
    const livrables = await this.requireSubmitted(
      instruction.id,
      dto.livrables.map((entry) => entry.livrableId),
    );
    assertDecider(instruction, livrables, validatorId);
    const motifs = new Map(
      dto.livrables.map((entry) => [entry.livrableId, entry.motif]),
    );

    const updated = await this.database.$transaction(async (tx) => {
      await this.recordDecisions(
        tx,
        instruction.id,
        instruction.cycle,
        validatorId,
        {
          decision: ValidationDecision.REJETE,
          livrables: livrables.map((livrable) => ({
            id: livrable.id,
            motif: motifs.get(livrable.id)!,
          })),
        },
      );
      return tx.instruction.update({
        where: { id: instruction.id },
        data: {
          status: InstructionStatus.A_CORRIGER,
          refusalReason:
            dto.comment ??
            livrables
              .map(
                (livrable) => `${livrable.title} : ${motifs.get(livrable.id)}`,
              )
              .join('\n'),
          ...(dto.agentDueDate
            ? { agentDueDate: new Date(dto.agentDueDate) }
            : {}),
        },
        include: instructionInclude,
      });
    });

    this.notifyInstruction(
      updated,
      updated.assignees.map((assignee) => assignee.user.id),
      {
        type: 'TASK_CORRECTIONS_REQUESTED',
        message: `Des corrections sont demandées sur la tâche « ${updated.title} » : ${livrables
          .map((livrable) => `${livrable.title} — ${motifs.get(livrable.id)}`)
          .join(' ; ')}`,
      },
      validatorId,
    );
    for (const livrable of livrables) {
      this.recordEvent(id, 'INSTRUCTION_CORRECTION_DEMANDEE', {
        livrableId: livrable.id,
        title: livrable.title,
        motif: motifs.get(livrable.id),
      });
    }
    return updated;
  }

  // One submitted livrable rejected on its own, with its motif. The
  // instruction moves to A_CORRIGER once no submitted livrable is left
  // to decide (see settleValidationRound).
  async rejectLivrable(livrableId: string, motif: string, validatorId: string) {
    const livrable = await this.database.livrable.findUnique({
      where: { id: livrableId },
      select: { instructionId: true },
    });
    if (!livrable) {
      throw new NotFoundException(`Livrable ${livrableId} not found`);
    }
    const instruction = await this.requireStatus(
      livrable.instructionId,
      DECIDING_STATUSES,
    );
    const [rejected] = await this.requireSubmitted(instruction.id, [
      livrableId,
    ]);
    assertDecider(instruction, [rejected], validatorId);

    const settled = await this.database.$transaction(async (tx) => {
      await this.recordDecisions(
        tx,
        instruction.id,
        instruction.cycle,
        validatorId,
        {
          decision: ValidationDecision.REJETE,
          livrables: [{ id: rejected.id, motif }],
        },
      );
      return this.settleValidationRound(tx, instruction.id);
    });

    this.notifyInstruction(
      instruction,
      instruction.assignees.map((assignee) => assignee.user.id),
      {
        type:
          settled === InstructionStatus.A_CORRIGER
            ? 'TASK_CORRECTIONS_REQUESTED'
            : 'TASK_LIVRABLE_REJECTED',
        message: `Le livrable « ${rejected.title} » de la tâche « ${instruction.title} » est rejeté : ${motif}`,
      },
      validatorId,
    );
    this.recordEvent(instruction.id, 'INSTRUCTION_CORRECTION_DEMANDEE', {
      livrableId: rejected.id,
      title: rejected.title,
      motif,
    });
    return this.database.livrable.findUniqueOrThrow({
      where: { id: livrableId },
      include: { validations: livrableValidations },
    });
  }

  private async approve(
    id: string,
    livrableIds: string[] | undefined,
    validatorId: string,
  ) {
    const instruction = await this.requireStatus(id, DECIDING_STATUSES);
    const chain = validationChain(instruction);
    const livrables = livrableIds
      ? await this.requireSubmitted(instruction.id, livrableIds)
      : instruction.livrables.filter(
          (livrable) =>
            livrable.status === LivrableStatus.SOUMIS &&
            !awaitsAvis(chain, livrable),
        );
    assertDecider(instruction, livrables, validatorId);
    if (livrables.length === 0) {
      throw new BadRequestException(
        'No submitted livrable awaits your decision',
      );
    }

    const settled = await this.database.$transaction(async (tx) => {
      await this.recordDecisions(
        tx,
        instruction.id,
        instruction.cycle,
        validatorId,
        {
          decision: ValidationDecision.VALIDE,
          livrables: livrables.map((livrable) => ({ id: livrable.id })),
        },
      );
      return this.settleValidationRound(tx, instruction.id);
    });
    if (settled === InstructionStatus.TERMINEE) {
      this.notifyInstruction(
        instruction,
        instruction.assignees.map((assignee) => assignee.user.id),
        {
          type: 'TASK_COMPLETED',
          message: `Tous les livrables de la tâche « ${instruction.title} » sont validés : la tâche est terminée`,
        },
        validatorId,
      );
    }
    for (const livrable of livrables) {
      this.recordEvent(instruction.id, 'INSTRUCTION_LIVRABLE_VALIDE', {
        livrableId: livrable.id,
        title: livrable.title,
      });
    }
    return this.findOne(instruction.id);
  }

  /**
   * The validateur's opinion on a submitted livrable (AVIS, with its
   * comment): it moves on to the superviseur, who decides. Only while it
   * awaits that opinion (SOUMIS, validationStep 0).
   */
  async giveAvis(livrableId: string, comment: string, userId: string) {
    const livrable = await this.database.livrable.findUnique({
      where: { id: livrableId },
      select: {
        instructionId: true,
        title: true,
        status: true,
        validationStep: true,
      },
    });
    if (!livrable) {
      throw new NotFoundException(`Livrable ${livrableId} not found`);
    }
    const instruction = await this.requireStatus(
      livrable.instructionId,
      DECIDING_STATUSES,
    );
    const chain = validationChain(instruction);
    if (!chain.validateur || chain.validateur !== userId) {
      throw new ForbiddenException(
        "Only this task's validateur gives an opinion on its livrables",
      );
    }
    if (
      livrable.status !== LivrableStatus.SOUMIS ||
      livrable.validationStep !== 0
    ) {
      throw new BadRequestException(
        `Livrable « ${livrable.title} » doesn't await an opinion (it is ${livrable.status}, step ${livrable.validationStep})`,
      );
    }

    await this.database.$transaction(async (tx) => {
      // Guarded on the step read above: a second opinion meanwhile fails.
      const { count } = await tx.livrable.updateMany({
        where: {
          id: livrableId,
          status: LivrableStatus.SOUMIS,
          validationStep: 0,
        },
        data: { validationStep: 1 },
      });
      if (count === 0) {
        throw new ConflictException(
          'An opinion was given on this livrable meanwhile — reload and try again',
        );
      }
      await tx.validation.create({
        data: {
          instructionId: instruction.id,
          livrableId,
          validatorId: userId,
          decision: ValidationDecision.AVIS,
          comment,
          cycle: instruction.cycle,
        },
      });
    });

    if (chain.decider) {
      this.notifyInstruction(
        instruction,
        [chain.decider],
        {
          type: 'TASK_VALIDATION_PENDING',
          message: `Le validateur a donné son avis sur « ${livrable.title} » (tâche « ${instruction.title} ») : à vous de décider.`,
        },
        userId,
      );
    }
    this.recordEvent(instruction.id, 'INSTRUCTION_AVIS_DONNE', {
      livrableId,
    });
    return this.database.livrable.findUniqueOrThrow({
      where: { id: livrableId },
      include: { validations: livrableValidations },
    });
  }

  // The given livrables, which must all be SOUMIS livrables of this
  // instruction — anything else is a 400 naming the offenders.
  private async requireSubmitted(instructionId: string, livrableIds: string[]) {
    const ids = [...new Set(livrableIds)];
    if (ids.length !== livrableIds.length) {
      throw new BadRequestException('A livrable is listed more than once');
    }
    const livrables = await this.database.livrable.findMany({
      where: {
        id: { in: ids },
        instructionId,
        status: LivrableStatus.SOUMIS,
      },
      select: { id: true, title: true, validationStep: true },
    });
    const missing = ids.filter((id) => !livrables.some((l) => l.id === id));
    if (missing.length) {
      throw new BadRequestException(
        `Not submitted livrables of this instruction: ${missing.join(', ')}`,
      );
    }
    return livrables;
  }

  // Moves the livrables to the decision's status and records one
  // Validation per livrable. The status update is guarded on SOUMIS, so
  // a concurrent decision on the same livrable makes the second one fail.
  private async recordDecisions(
    tx: Prisma.TransactionClient,
    instructionId: string,
    cycle: number,
    validatorId: string,
    round: {
      decision:
        typeof ValidationDecision.VALIDE | typeof ValidationDecision.REJETE;
      livrables: { id: string; motif?: string }[];
    },
  ) {
    const ids = round.livrables.map((livrable) => livrable.id);
    const { count } = await tx.livrable.updateMany({
      where: { id: { in: ids }, status: LivrableStatus.SOUMIS },
      data: {
        status:
          round.decision === ValidationDecision.VALIDE
            ? LivrableStatus.VALIDE
            : LivrableStatus.REJETE,
      },
    });
    if (count !== ids.length) {
      throw new ConflictException(
        'A livrable was decided meanwhile — reload and try again',
      );
    }
    await tx.validation.createMany({
      data: round.livrables.map((livrable) => ({
        instructionId,
        livrableId: livrable.id,
        validatorId,
        decision: round.decision,
        motif: livrable.motif,
        cycle,
      })),
    });
  }

  // Ends a validation round once nothing is left SOUMIS: an instruction
  // with rejected livrables not yet replaced by a new version goes to
  // A_CORRIGER; one whose current versions are all VALIDE is done — it
  // closes itself (TERMINEE) and the dossier progress is refreshed.
  // Returns the status it moved to, or null while the round is open.
  private async settleValidationRound(
    tx: Prisma.TransactionClient,
    instructionId: string,
  ) {
    const [submitted, openRejections, current, validated] = await Promise.all([
      tx.livrable.count({
        where: { instructionId, status: LivrableStatus.SOUMIS },
      }),
      tx.livrable.count({
        where: {
          instructionId,
          status: LivrableStatus.REJETE,
          isLatest: true,
        },
      }),
      tx.livrable.count({ where: { instructionId, isLatest: true } }),
      tx.livrable.count({
        where: { instructionId, isLatest: true, status: LivrableStatus.VALIDE },
      }),
    ]);
    if (submitted > 0) return null;
    if (openRejections > 0) {
      await tx.instruction.update({
        where: { id: instructionId },
        data: { status: InstructionStatus.A_CORRIGER },
      });
      return InstructionStatus.A_CORRIGER;
    }
    if (current > 0 && validated === current) {
      const { dossierId } = await tx.instruction.update({
        where: { id: instructionId },
        data: { status: InstructionStatus.TERMINEE, closedAt: new Date() },
        select: { dossierId: true },
      });
      if (dossierId) {
        await refreshDossierProgress(tx, dossierId);
      }
      return InstructionStatus.TERMINEE;
    }
    return null;
  }

  private async requireStatus(id: string, allowed: InstructionStatus[]) {
    const instruction = await this.findOne(id);
    if (!allowed.includes(instruction.status)) {
      throw new BadRequestException(
        `Instruction is ${instruction.status}, expected one of: ${allowed.join(', ')}`,
      );
    }
    return instruction;
  }

  private setStatus(id: string, status: InstructionStatus) {
    return this.database.instruction.update({
      where: { id },
      data: { status },
      include: instructionInclude,
    });
  }

  // RG-INS-002 + access grants: assigning someone a task they couldn't
  // otherwise see must not leave them unable to open it. Dossier and
  // Courrier each have their own independent access list (see
  // DossierAccess/CourrierAccess in schema.prisma — a grant on one is never
  // inherited from, or propagated to, the other), so an assignee needs a
  // grant on *both* the instruction's dossier and, if it has one, the
  // courrier it was raised from. Never touches `canEdit`, so this only ever
  // widens, never narrows, access.
  private async ensureViewAccess(
    userIds: string[],
    target: { dossierId: string | null; courrierId: string | null },
  ) {
    const uniqueIds = [...new Set(userIds)];
    if (uniqueIds.length === 0) {
      return;
    }
    await this.database.$transaction([
      ...(target.dossierId
        ? uniqueIds.map((userId) =>
            this.database.dossierAccess.upsert({
              where: {
                dossierId_userId: { dossierId: target.dossierId!, userId },
              },
              create: { dossierId: target.dossierId!, userId, canView: true },
              update: { canView: true },
            }),
          )
        : []),
      ...(target.courrierId
        ? uniqueIds.map((userId) =>
            this.database.courrierAccess.upsert({
              where: {
                courrierId_userId: { courrierId: target.courrierId!, userId },
              },
              create: {
                courrierId: target.courrierId!,
                userId,
                canView: true,
              },
              update: { canView: true },
            }),
          )
        : []),
    ]);
  }

  private async ensureNotTerminal(id: string) {
    const instruction = await this.findOne(id);
    if (
      instruction.status === InstructionStatus.TERMINEE ||
      instruction.status === InstructionStatus.ANNULEE
    ) {
      throw new BadRequestException(
        `Instruction is already ${instruction.status.toLowerCase()}`,
      );
    }
    return instruction;
  }

  async deposerLivrables(
    instructionId: string,
    dto: DeposerLivrablesDto,
    files: Array<Express.Multer.File>,
    userId: string,
  ) {
    if (!dto || !dto.livrables) {
      throw new BadRequestException('Le champ livrables est obligatoire');
    }

    let livrablesList: Array<{ livrableId: string; files: string[] }>;
    if (typeof dto.livrables === 'string') {
      try {
        livrablesList = JSON.parse(dto.livrables);
      } catch {
        throw new BadRequestException(
          'Format JSON invalide pour le champ livrables',
        );
      }
    } else if (Array.isArray(dto.livrables)) {
      livrablesList = dto.livrables;
    } else {
      throw new BadRequestException('Le champ livrables doit être un tableau');
    }

    if (!Array.isArray(livrablesList) || livrablesList.length === 0) {
      throw new BadRequestException('Au moins un livrable doit être fourni');
    }

    const seenIds = new Set<string>();
    for (const item of livrablesList) {
      if (!item.livrableId) {
        throw new BadRequestException('Chaque entrée doit avoir un livrableId');
      }
      if (seenIds.has(item.livrableId)) {
        throw new BadRequestException(
          `Livrable ${item.livrableId} : spécifié plusieurs fois`,
        );
      }
      seenIds.add(item.livrableId);

      if (!Array.isArray(item.files) || item.files.length === 0) {
        throw new BadRequestException(
          `Livrable ${item.livrableId} : aucun fichier fourni`,
        );
      }
      for (const fileField of item.files) {
        const found = files.find((f) => f.fieldname === fileField);
        if (!found) {
          throw new BadRequestException(
            `Livrable ${item.livrableId} : fichier "${fileField}" manquant ou refusé`,
          );
        }
      }
    }

    // 1. Vérifier que l'instruction est EN_COURS, A_CORRIGER ou
    // EN_ATTENTE_VALIDATION, et que l'utilisateur est l'exécutant qui y a
    // souscrit : lui seul dépose ses livrables, sans avoir besoin de
    // LIVRABLE_DEPOSIT ni LIVRABLE_SUBMIT (assertSubscriber).
    const instruction = await this.database.instruction.findUnique({
      where: { id: instructionId },
      include: {
        assignees: { include: { user: { select: { id: true, name: true } } } },
        dossier: { select: { id: true, siteId: true } },
      },
    });
    if (!instruction) {
      throw new NotFoundException(`Instruction ${instructionId} not found`);
    }

    const ALLOWED_STATUSES: InstructionStatus[] = [
      InstructionStatus.EN_COURS,
      InstructionStatus.A_CORRIGER,
      InstructionStatus.EN_ATTENTE_VALIDATION,
    ];
    if (!ALLOWED_STATUSES.includes(instruction.status)) {
      throw new BadRequestException(
        `Instruction is ${instruction.status} — livrables can only be deposited while it is ${ALLOWED_STATUSES.join(', ')}`,
      );
    }

    await this.assertSubscriber(instructionId, userId);

    if (instruction.dossierId) {
      await assertDossierOpenForActivity(this.database, instruction.dossierId);
    }

    // 2. Vérifier que chaque livrableId appartient à l'instruction,
    // est la dernière version (isLatest) et est EN_PREPARATION ou REJETE.
    const current = new Map<string, Livrable>();
    for (const item of livrablesList) {
      const livrable = await this.database.livrable.findUnique({
        where: { id: item.livrableId },
      });
      if (!livrable) {
        throw new NotFoundException(`Livrable ${item.livrableId} introuvable`);
      }
      if (livrable.instructionId !== instruction.id) {
        throw new BadRequestException(
          `Livrable ${item.livrableId} : n'appartient pas à cette instruction`,
        );
      }
      if (!livrable.isLatest) {
        throw new BadRequestException(
          `Livrable ${item.livrableId} : n'est pas la dernière version`,
        );
      }
      if (
        livrable.status !== LivrableStatus.EN_PREPARATION &&
        livrable.status !== LivrableStatus.REJETE
      ) {
        throw new BadRequestException(
          `Livrable ${item.livrableId} : statut ${livrable.status} incompatible (attendu : EN_PREPARATION ou REJETE)`,
        );
      }
      current.set(livrable.id, livrable);
    }

    // 3 & 5. Pour chaque livrable : enregistrer les fichiers (comme POST /documents avec livrableId),
    // passer le livrable à DEPOSE puis SOUMIS, enregistrer agentComment.
    // En cas d'erreur sur n'importe quel livrable : tout annuler, y compris les fichiers déjà
    // envoyés au stockage, et renvoyer 400 en précisant le livrableId en cause.
    const uploadedKeys: string[] = [];
    // The livrable each deposited one ends up as: itself, or its new
    // version when it was sent back for corrections.
    const target = new Map<string, string>();
    const filesToPersist: Array<{
      livrableId: string;
      file: Express.Multer.File;
      storageKey: string;
    }> = [];

    try {
      for (const item of livrablesList) {
        const prefix = `livrables/${item.livrableId}`;
        for (const fileField of item.files) {
          const file = files.find((f) => f.fieldname === fileField)!;
          try {
            const { key } = await this.storage.upload(file.buffer, {
              originalName: file.originalname,
              contentType: file.mimetype,
              prefix,
            });
            uploadedKeys.push(key);
            filesToPersist.push({
              livrableId: item.livrableId,
              file,
              storageKey: key,
            });
          } catch (storageError) {
            throw new BadRequestException(
              `Livrable ${item.livrableId} : échec du stockage du fichier "${file.originalname}"`,
            );
          }
        }
      }

      await this.database.$transaction(async (tx) => {
        // Un livrable renvoyé en correction (REJETE) est redéposé comme une
        // nouvelle version (version + 1, même position) : la version
        // corrigée garde ses fichiers et reste consultable dans `history`,
        // les nouveaux fichiers vont à la nouvelle version.
        for (const item of livrablesList) {
          const livrable = current.get(item.livrableId)!;
          if (livrable.status !== LivrableStatus.REJETE) {
            target.set(livrable.id, livrable.id);
            continue;
          }
          const { count } = await tx.livrable.updateMany({
            where: { id: livrable.id, isLatest: true },
            data: { isLatest: false },
          });
          if (count === 0) {
            throw new ConflictException(
              `Livrable ${livrable.id} : une nouvelle version vient d'être créée — rechargez la tâche`,
            );
          }
          const next = await tx.livrable.create({
            data: {
              instructionId: livrable.instructionId,
              title: livrable.title,
              description: livrable.description,
              version: livrable.version + 1,
              position: livrable.position,
              parentVersionId: livrable.id,
              createdById: userId,
            },
            select: { id: true },
          });
          target.set(livrable.id, next.id);
        }

        // Enregistrer les fichiers
        for (const doc of filesToPersist) {
          await tx.document.create({
            data: {
              originalName: doc.file.originalname,
              name: doc.file.originalname,
              storageKey: doc.storageKey,
              mimeType: doc.file.mimetype,
              sizeBytes: doc.file.size,
              livrableId: target.get(doc.livrableId)!,
              uploadedById: userId,
            },
          });
        }

        // Passer chaque livrable à SOUMIS et enregistrer agentComment si fourni
        for (const item of livrablesList) {
          await tx.livrable.update({
            where: { id: target.get(item.livrableId)! },
            data: {
              status: LivrableStatus.SOUMIS,
              validationStep: 0,
              ...(dto.agentComment !== undefined
                ? { agentComment: dto.agentComment }
                : {}),
            },
          });
        }

        // Mettre à jour le statut de l'instruction (EN_ATTENTE_VALIDATION)
        await tx.instruction.update({
          where: { id: instruction.id },
          data: { status: InstructionStatus.EN_ATTENTE_VALIDATION },
        });
      });
    } catch (error) {
      await Promise.all(
        uploadedKeys.map((k) => this.storage.delete(k).catch(() => undefined)),
      );
      throw error;
    }

    // 4. Notifier le superviseur une seule fois et journaliser dans /instructions/{id}/historique
    const executantUser = instruction.assignees.find(
      (a) => a.user.id === userId,
    )?.user;
    const actorName = executantUser?.name ?? 'Un exécutant';

    // The validateur gives their opinion first; without one, the superviseur
    // decides straight away.
    const chain = validationChain(instruction);
    const firstLink = chain.validateur ?? chain.decider;
    const recipientIds = firstLink ? [firstLink] : [];

    const n = livrablesList.length;
    const livrablesLabel = `${n} livrable${n > 1 ? 's' : ''}`;

    this.notifyInstruction(
      instruction,
      recipientIds,
      {
        type: 'TASK_LIVRABLES_DEPOSITED',
        message: `${actorName} a déposé ${livrablesLabel} pour la tâche « ${instruction.title} ».`,
      },
      userId,
    );

    this.recordEvent(
      instruction.id,
      'INSTRUCTION_LIVRABLES_DEPOSES',
      {
        livrableIds: livrablesList.map((l) => target.get(l.livrableId)),
        count: n,
        agentComment: dto.agentComment,
      },
      `${actorName} a déposé ${livrablesLabel}`,
    );

    // Réponse 201 : l'instruction complète, comme GET /instructions/{id}
    return this.findOne(instruction.id);
  }
}
