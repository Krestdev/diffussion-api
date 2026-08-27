import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  InstructionStatus,
  LivrableStatus,
  NotificationCanal,
  Prisma,
  UserInstructionRole,
} from '../../generated/prisma/client';
import { createWithUniqueReference } from '../common/utils/generate-reference';
import { DatabaseService } from '../database/database.service';
import { NotificationsService } from '../notifications/notifications.service';
import { AssignInstructionDto } from './dto/assign-instruction.dto';
import { CreateInstructionsDto } from './dto/create-instruction.dto';
import { FindInstructionsQueryDto } from './dto/find-instructions.query.dto';
import { RefuseInstructionDto } from './dto/refuse-instruction.dto';
import { UpdateInstructionDto } from './dto/update-instruction.dto';

const instructionInclude = {
  assignees: { include: { user: { select: { id: true, name: true } } } },
  livrables: true,
  dossier: { select: { id: true, number: true, title: true } },
  courrier: { select: { id: true, number: true, subject: true } },
} satisfies Prisma.InstructionInclude;

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
    instruction: { id: string; title: string; dossierId: string; courrierId: string | null },
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
    const { executantIds, superviseurId, dueDate, ...data } = dto;
    const hasAssignees = Boolean(executantIds?.length || superviseurId);

    const instruction = await createWithUniqueReference('T', (number) =>
      this.database.instruction.create({
        data: {
          ...data,
          number,
          dueDate: dueDate ? new Date(dueDate) : undefined,
          createdById,
          status: hasAssignees
            ? InstructionStatus.AFFECTEE
            : InstructionStatus.A_AFFECTER,
          assignees: hasAssignees
            ? {
                createMany: {
                  data: assignmentRows({ executantIds, superviseurId }),
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

    return { data, total, skip: query.skip ?? 0, take: query.take ?? 20 };
  }

  async findOne(id: string) {
    const instruction = await this.database.instruction.findUnique({
      where: { id },
      include: instructionInclude,
    });
    if (!instruction) {
      throw new NotFoundException(`Instruction ${id} not found`);
    }
    return instruction;
  }

  // RG-INS-005: mutable as long as the dossier is not closed. The dossier
  // being closed already implies every one of its instructions is terminal,
  // so it's enough to just refuse edits on a terminal instruction here.
  async update(id: string, dto: UpdateInstructionDto) {
    const instruction = await this.ensureNotTerminal(id);
    const { dueDate, ...data } = dto;
    return this.database.instruction.update({
      where: { id: instruction.id },
      data: { ...data, dueDate: dueDate ? new Date(dueDate) : undefined },
      include: instructionInclude,
    });
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
        status: InstructionStatus.AFFECTEE,
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

  // RG-INS-003: the executant accepts.
  async accept(id: string) {
    const instruction = await this.requireStatus(id, [
      InstructionStatus.AFFECTEE,
    ]);
    return this.setStatus(instruction.id, InstructionStatus.EN_COURS);
  }

  // RG-INS-003/004: the executant refuses, and must motivate it.
  async refuse(id: string, dto: RefuseInstructionDto) {
    const instruction = await this.requireStatus(id, [
      InstructionStatus.AFFECTEE,
    ]);
    return this.database.instruction.update({
      where: { id: instruction.id },
      data: {
        status: InstructionStatus.REFUSEE,
        refusalReason: dto.motif,
      },
      include: instructionInclude,
    });
  }

  // 10.4.4.7: closing requires every livrable attached to the instruction to
  // already be VALIDE (RG-LIV-005 — validation is pronounced on the
  // instruction as a whole, so this is the gate for that pronouncement).
  async close(id: string) {
    const instruction = await this.requireStatus(id, [
      InstructionStatus.EN_COURS,
      InstructionStatus.EN_ATTENTE_VALIDATION,
    ]);

    const outstanding = await this.database.livrable.count({
      where: {
        instructionId: instruction.id,
        status: { not: LivrableStatus.VALIDE },
      },
    });
    if (outstanding > 0) {
      throw new BadRequestException(
        `${outstanding} livrable(s) are not yet validated`,
      );
    }

    return this.database.instruction.update({
      where: { id: instruction.id },
      data: { status: InstructionStatus.TERMINEE, closedAt: new Date() },
      include: instructionInclude,
    });
  }

  async cancel(id: string) {
    const instruction = await this.ensureNotTerminal(id);
    return this.setStatus(instruction.id, InstructionStatus.ANNULEE);
  }

  // 10.4.4.6 "Contrôle par le superviseur" — the approving half. Livrables
  // submitted for this round move to VALIDE; the instruction stays
  // EN_ATTENTE_VALIDATION so the responsable still explicitly calls
  // `close()` (RG-LIV-005: the pronouncement is on the instruction, closing
  // it is a separate, deliberate step).
  async approveLivrables(id: string) {
    const instruction = await this.requireStatus(id, [
      InstructionStatus.EN_ATTENTE_VALIDATION,
    ]);
    await this.database.livrable.updateMany({
      where: { instructionId: instruction.id, status: LivrableStatus.SOUMIS },
      data: { status: LivrableStatus.VALIDE },
    });
    return this.findOne(instruction.id);
  }

  // 10.4.4.6, rejection branch: submitted livrables go back to REJETE and
  // the instruction returns to EN_COURS for the executant to address the
  // observations (motif carried on `refusalReason`, reused for both refusal
  // paths of an instruction's lifecycle).
  async requestCorrections(id: string, motif: string) {
    const instruction = await this.requireStatus(id, [
      InstructionStatus.EN_ATTENTE_VALIDATION,
    ]);
    await this.database.livrable.updateMany({
      where: { instructionId: instruction.id, status: LivrableStatus.SOUMIS },
      data: { status: LivrableStatus.REJETE },
    });
    const updated = await this.database.instruction.update({
      where: { id: instruction.id },
      data: { status: InstructionStatus.A_CORRIGER, refusalReason: motif },
      include: instructionInclude,
    });
    this.notifyInstruction(
      updated,
      updated.assignees.map((assignee) => assignee.user.id),
      {
        type: 'TASK_CORRECTIONS_REQUESTED',
        message: `Des corrections sont demandées sur la tâche « ${updated.title} ».`,
      },
    );
    return updated;
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
