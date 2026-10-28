import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  InstructionStatus,
  LivrableStatus,
  NotificationCanal,
  Prisma,
  SubscriptionDecision,
  UserInstructionRole,
  ValidationDecision,
} from '../../generated/prisma/client';
import { DEFAULT_TAKE } from '../common/dto/pagination.query.dto';
import { dateRange } from '../common/utils/date-range';
import { lastLivrableValidation } from '../common/utils/livrable-history';
import { createWithUniqueReference } from '../common/utils/generate-reference';
import {
  assertDossierOpenForActivity,
  markDossierInProgress,
  refreshDossierProgress,
} from '../common/utils/dossier-lifecycle';
import { DatabaseService } from '../database/database.service';
import { NotificationsService } from '../notifications/notifications.service';
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
    include: { validations: lastLivrableValidation },
    orderBy: { createdAt: 'asc' },
  },
  dossier: { select: { id: true, number: true, title: true } },
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
  superviseurId?: string;
}) {
  const rows: Prisma.UserInstructionsCreateManyInstructionInput[] = [];
  for (const userId of dto.executantIds ?? []) {
    rows.push({ userId, role: UserInstructionRole.EXECUTANT });
  }
  if (dto.superviseurId) {
    rows.push({
      userId: dto.superviseurId,
      role: UserInstructionRole.SUPERVISEUR,
    });
  }
  return rows;
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

@Injectable()
export class InstructionsService {
  constructor(
    private readonly database: DatabaseService,
    private readonly notifications: NotificationsService,
  ) {}

  private notifyInstruction(
    instruction: { id: string; dossierId: string; courrierId: string | null },
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
        dossierId: instruction.dossierId,
        courrierId: instruction.courrierId ?? undefined,
      })
      .catch((error: unknown) => {
        console.error('Failed to create instruction notification', error);
      });
  }

  private notifyAssignment(
    instruction: {
      id: string;
      title: string;
      dossierId: string;
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
      dueDate,
      agentDueDate,
      dependsOnId,
      livrables,
      ...data
    } = dto;
    assertDeadlines(toDate(dueDate), toDate(agentDueDate));
    const hasAssignees = Boolean(executantIds?.length || superviseurId);
    await assertDossierOpenForActivity(this.database, data.dossierId);

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
          assignees: hasAssignees
            ? {
                createMany: {
                  data: assignmentRows({ executantIds, superviseurId }),
                },
              }
            : undefined,
          // Sub-tasks: a single parent picked at creation (the frontend's
          // AddTaskDialog exposes one "Tâche parent" field) — the schema
          // itself allows several, this just doesn't expose that yet.
          dependsOn: dependsOnId ? { create: { dependsOnId } } : undefined,
          livrables: livrables?.length
            ? {
                createMany: {
                  data: livrables.map((l) => ({
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

    if (hasAssignees) {
      const assigneeIds = [...(executantIds ?? []), superviseurId].filter(
        (userId): userId is string => Boolean(userId),
      );
      await this.ensureViewAccess(assigneeIds, {
        dossierId: instruction.dossierId,
        courrierId: instruction.courrierId,
      });
      this.notifyAssignment(instruction, assigneeIds, createdById);
    }

    await markDossierInProgress(this.database, instruction.dossierId);
    await refreshDossierProgress(this.database, instruction.dossierId);
    return instruction;
  }

  async findAll(query: FindInstructionsQueryDto) {
    const where: Prisma.InstructionWhereInput = {
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
    // "Renvoyées" is the creator's queue: tasks no executant subscribed to
    // come back to whoever created them.
    const inTab = (name: TaskTab): Prisma.InstructionWhereInput => ({
      ...(name === 'renvoyees' ? { createdById: userId } : mine),
      status: { in: [...TASK_TABS[name]] },
    });

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

    const [data, total, inProgress, completed, returned] =
      await this.database.$transaction([
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
      ]);

    const now = new Date();
    return {
      data: data.map((instruction) => withOverdue(instruction, now)),
      total,
      skip,
      take,
      metrics: { inProgress, completed, returned },
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
        overdueNotifiedAt: sameDate(nextDue, instruction.dueDate)
          ? undefined
          : null,
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
    const allowed = superviseurs.length
      ? superviseurs.some((assignee) => assignee.user.id === userId)
      : instruction.createdById === userId;
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
    if (!dto.executantIds?.length && !dto.superviseurId) {
      throw new BadRequestException(
        'Provide at least one executant or a superviseur',
      );
    }

    const updated = await this.database.instruction.update({
      where: { id: instruction.id },
      data: {
        status: statusOnAssignment(dto.executantIds),
        assignees: {
          deleteMany: {},
          createMany: { data: assignmentRows(dto) },
        },
      },
      include: instructionInclude,
    });

    const assigneeIds = [...(dto.executantIds ?? []), dto.superviseurId].filter(
      (userId): userId is string => Boolean(userId),
    );
    await this.ensureViewAccess(assigneeIds, {
      dossierId: instruction.dossierId,
      courrierId: instruction.courrierId,
    });
    this.notifyAssignment(updated, assigneeIds);

    return updated;
  }

  // RG-INS-003/004: an executant doesn't subscribe, with a motif, and
  // leaves the task — which they never modify. The other executants keep
  // it; with none left it goes back to its creator (NON_SOUSCRITE), who
  // reassigns or adjusts it. Only before subscribing: once subscribed, the
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
    this.notifyInstruction(
      updated,
      [updated.createdById],
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
    return subscribed;
  }

  // 10.4.4.7: closing requires every livrable attached to the instruction to
  // already be VALIDE (RG-LIV-005 — validation is pronounced on the
  // instruction as a whole, so this is the gate for that pronouncement).
  async close(id: string) {
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
      data: { status: InstructionStatus.TERMINEE, closedAt: new Date() },
      include: instructionInclude,
    });
    await refreshDossierProgress(this.database, closed.dossierId);
    return closed;
  }

  async cancel(id: string) {
    const instruction = await this.ensureNotTerminal(id);
    const cancelled = await this.setStatus(
      instruction.id,
      InstructionStatus.ANNULEE,
    );
    await refreshDossierProgress(this.database, cancelled.dossierId);
    return cancelled;
  }

  // 10.4.4.6 "Contrôle par le superviseur" — the approving half. Livrables
  // submitted for this round move to VALIDE; once every current version is
  // validated the instruction closes itself (TERMINEE), and if livrables
  // rejected one by one earlier in the round are still open it goes back
  // for corrections instead (see settleValidationRound).
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

  // 10.4.4.6, rejection branch: the listed submitted livrables go to REJETE,
  // each with its own motif (a Validation row), and the instruction moves
  // to A_CORRIGER for the executant to address them. Submitted livrables
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
    return this.database.livrable.findUniqueOrThrow({
      where: { id: livrableId },
      include: { validations: lastLivrableValidation },
    });
  }

  private async approve(
    id: string,
    livrableIds: string[] | undefined,
    validatorId: string,
  ) {
    const instruction = await this.requireStatus(id, DECIDING_STATUSES);
    const livrables = livrableIds
      ? await this.requireSubmitted(instruction.id, livrableIds)
      : instruction.livrables.filter(
          (livrable) => livrable.status === LivrableStatus.SOUMIS,
        );
    if (livrables.length === 0) {
      throw new BadRequestException('No submitted livrable to approve');
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
    return this.findOne(instruction.id);
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
      select: { id: true, title: true },
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
      await refreshDossierProgress(tx, dossierId);
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
    target: { dossierId: string; courrierId: string | null },
  ) {
    const uniqueIds = [...new Set(userIds)];
    if (uniqueIds.length === 0) {
      return;
    }
    await this.database.$transaction([
      ...uniqueIds.map((userId) =>
        this.database.dossierAccess.upsert({
          where: {
            dossierId_userId: { dossierId: target.dossierId, userId },
          },
          create: { dossierId: target.dossierId, userId, canView: true },
          update: { canView: true },
        }),
      ),
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
}
