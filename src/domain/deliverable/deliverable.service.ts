import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  InstructionStatus,
  LivrableStatus,
  Prisma,
} from '../../../generated/prisma/client';
import { Permission } from '../../auth/permissions';
import { AccessService } from '../../auth/access/access.service';
import { ActivityService } from '../../activity/activity.service';
import { assertDossierOpenForActivity } from '../../common/utils/dossier-lifecycle';
import {
  livrableOrder,
  livrableValidations,
  nextLivrablePosition,
  withLivrableHistory,
} from '../../common/utils/livrable-history';
import { visibleContractWhere } from '../../common/utils/referential-access';
import { DatabaseService } from '../../database/database.service';
import { CreateDeliverableDto } from './dto/create-deliverable.dto';
import { FindDeliverableQueryDto } from './dto/find-deliverable-query.dto';
import { UpdateDeliverableDto } from './dto/update-deliverable.dto';
import {
  invalidTransition,
  WorkflowService,
} from '../../workflow/workflow.service';
import { INSTRUCTION_STATES } from '../../instructions/instruction.states';
import { LIVRABLE_STATES, LivrableEvent } from './livrable.states';

const deliverableInclude = {
  documents: true,
  versions: { orderBy: { version: 'asc' } },
  // Latest supervisor decision, with its motif when rejected.
  validations: livrableValidations,
} satisfies Prisma.LivrableInclude;

// Each earlier version in `history`: its files and its decision.
const historyInclude = {
  documents: true,
  validations: livrableValidations,
} satisfies Prisma.LivrableInclude;

const TERMINAL_INSTRUCTION_STATUSES: InstructionStatus[] = [
  InstructionStatus.TERMINEE,
  InstructionStatus.ANNULEE,
];

@Injectable()
export class DeliverableService {
  constructor(
    private readonly database: DatabaseService,
    private readonly access: AccessService,
    private readonly activity: ActivityService,
    private readonly workflow: WorkflowService,
  ) {}

  private recordInstructionEvent(
    instructionId: string,
    action: string,
    metadata?: Record<string, unknown>,
  ) {
    this.activity
      .tryRecord({
        action,
        entityType: 'Instruction',
        entityId: instructionId,
        metadata,
      })
      .catch(() => undefined);
  }

  async create(dto: CreateDeliverableDto, createdById: string) {
    await this.assertInstructionDossierOpen(dto.instructionId);
    const position = await nextLivrablePosition(
      this.database,
      dto.instructionId,
    );
    return this.database.$transaction(async (tx) => {
      const created = await tx.livrable.create({
        data: { ...dto, position, createdById },
        include: deliverableInclude,
      });
      await this.workflow.record(tx, {
        table: LIVRABLE_STATES,
        entityId: created.id,
        toStatus: created.status,
      });
      return created;
    });
  }

  async findAll(query: FindDeliverableQueryDto, userId: string) {
    // One row per livrable: its current version, earlier ones in `history`.
    // Only the livrables of the caller's company (when they hold
    // deliverable.read).
    const atReadableCompanies = await this.access.companyFilter(
      userId,
      Permission.DELIVERABLE_READ,
      (companyId): Prisma.LivrableWhereInput => ({
        instruction: { dossier: { companyId } },
      }),
    );
    const where: Prisma.LivrableWhereInput = {
      isLatest: true,
      instructionId: query.instructionId,
      status: query.status,
      ...(Object.keys(atReadableCompanies).length === 0
        ? {}
        : {
            OR: [
              atReadableCompanies,
              // A task under a contract has no dossier, hence no company: its
              // livrables are read by those involved in it, and by those
              // who may open its contract.
              {
                instruction: {
                  dossierId: null,
                  OR: [
                    { createdById: userId },
                    { assignees: { some: { userId } } },
                    { contract: visibleContractWhere(userId) },
                  ],
                },
              },
            ],
          }),
    };

    const [data, total] = await this.database.$transaction([
      this.database.livrable.findMany({
        where,
        include: deliverableInclude,
        // A task's livrables in the order they were entered; across
        // tasks, the most recent first.
        orderBy: query.instructionId
          ? livrableOrder
          : [{ createdAt: 'desc' }, { id: 'asc' }],
        skip: query.skip ?? 0,
        take: query.take ?? 20,
      }),
      this.database.livrable.count({ where }),
    ]);

    return {
      data: await withLivrableHistory(this.database, data, historyInclude),
      total,
      skip: query.skip ?? 0,
      take: query.take ?? 20,
    };
  }

  // GET /deliverables/:id: the version asked for, with the versions before
  // it in `history` (an old version shows isLatest: false).
  async findOneWithHistory(id: string) {
    const [livrable] = await withLivrableHistory(
      this.database,
      [await this.findOne(id)],
      historyInclude,
    );
    return livrable;
  }

  async findOne(id: string) {
    const livrable = await this.database.livrable.findUnique({
      where: { id },
      include: deliverableInclude,
    });
    if (!livrable) {
      throw new NotFoundException(`Livrable ${id} not found`);
    }
    return livrable;
  }

  // RG-LIV-007: once a livrable has left EN_PREPARATION, an "edit" creates a
  // new version instead of mutating history.
  async update(id: string, dto: UpdateDeliverableDto) {
    const livrable = await this.findOne(id);
    if (livrable.status !== LivrableStatus.EN_PREPARATION) {
      throw new BadRequestException(
        'This livrable has already been deposited — use "new version" to revise it',
      );
    }
    return this.database.livrable.update({
      where: { id },
      data: dto,
      include: deliverableInclude,
    });
  }

  // A correction answers a rejection: only the latest version, once
  // REJETE, gets a new version — so history stays linear (v1 -> v2 -> v3)
  // and InstructionsService.settleValidationRound can rely on `isLatest`.
  async newVersion(id: string, dto: UpdateDeliverableDto, createdById: string) {
    const parent = await this.findOne(id);
    if (!parent.isLatest) {
      const latest = await this.latestVersionOf(parent.id);
      throw new BadRequestException(
        `Version ${parent.version} has already been replaced — use the latest version (v${latest.version}, ${latest.id})`,
      );
    }
    if (parent.status !== LivrableStatus.REJETE) {
      throw new BadRequestException(
        `Livrable is ${parent.status} — a new version can only answer a rejection (REJETE)`,
      );
    }
    await this.assertInstructionDossierOpen(parent.instructionId);
    return this.database.$transaction(async (tx) => {
      // Guarded on isLatest: two concurrent calls can't both branch off it.
      const { count } = await tx.livrable.updateMany({
        where: { id: parent.id, isLatest: true },
        data: { isLatest: false },
      });
      if (count !== 1) {
        throw new ConflictException(
          'A new version of this livrable was just created — reload it',
        );
      }
      const created = await tx.livrable.create({
        data: {
          instructionId: parent.instructionId,
          title: dto.title ?? parent.title,
          description: dto.description ?? parent.description,
          version: parent.version + 1,
          // A new version keeps its place among the task's livrables.
          position: parent.position,
          parentVersionId: parent.id,
          createdById,
        },
        include: deliverableInclude,
      });
      await this.workflow.record(tx, {
        table: LIVRABLE_STATES,
        entityId: created.id,
        toStatus: created.status,
        event: 'NEW_VERSION',
      });
      return created;
    });
  }

  async remove(id: string) {
    const livrable = await this.findOne(id);
    if (livrable.status !== LivrableStatus.EN_PREPARATION) {
      throw new BadRequestException(
        'Only a livrable still in preparation can be removed',
      );
    }
    await this.database.livrable.delete({ where: { id } });
  }

  async deposit(id: string, agentComment?: string) {
    const livrable = await this.requireEvent(id, 'DEPOSIT');
    const updated = await this.database.$transaction(async (tx) => {
      await this.workflow.transition(tx, {
        table: LIVRABLE_STATES,
        delegate: tx.livrable,
        entityId: livrable.id,
        event: 'DEPOSIT',
        from: livrable.status,
        data: { agentComment: agentComment ?? undefined },
      });
      return tx.livrable.findUniqueOrThrow({
        where: { id: livrable.id },
        include: deliverableInclude,
      });
    });
    this.recordInstructionEvent(
      updated.instructionId,
      'INSTRUCTION_LIVRABLE_DEPOSE',
      { livrableId: id },
    );
    return updated;
  }

  // 10.5.4.4: once submitted, the parent instruction moves to
  // EN_ATTENTE_VALIDATION (from EN_COURS or A_CORRIGER, for a resubmission
  // after corrections).
  // Only while the instruction is being worked on or validated: a
  // livrable submitted on an instruction in any other state (AFFECTEE,
  // TERMINEE, ANNULEE...) would sit SOUMIS with nobody able to decide it.
  async submit(id: string) {
    const livrable = await this.findOne(id);
    // This route submits a DEPOSE livrable only (the deposer route submits from
    // EN_PREPARATION): 409 INVALID_TRANSITION otherwise.
    if (livrable.status !== LivrableStatus.DEPOSE) {
      throw invalidTransition('Livrable', livrable.status, 'SUBMIT');
    }
    const instruction = await this.database.instruction.findUniqueOrThrow({
      where: { id: livrable.instructionId },
      select: { status: true },
    });
    // EN_COURS, A_CORRIGER or EN_ATTENTE_VALIDATION (409 INVALID_TRANSITION otherwise).
    this.workflow.assertAllowed(
      INSTRUCTION_STATES,
      instruction.status,
      'DEPOSIT',
    );
    return this.database.$transaction(async (tx) => {
      await this.workflow.transition(tx, {
        table: LIVRABLE_STATES,
        delegate: tx.livrable,
        entityId: livrable.id,
        event: 'SUBMIT',
        from: livrable.status,
        // Each submission goes through the validation chain from its start.
        data: { validationStep: 0 },
      });
      await this.workflow.transition(tx, {
        table: INSTRUCTION_STATES,
        delegate: tx.instruction,
        entityId: livrable.instructionId,
        event: 'DEPOSIT',
        from: instruction.status,
      });
      return tx.livrable.findUniqueOrThrow({
        where: { id: livrable.id },
        include: deliverableInclude,
      });
    });
  }

  // Follows the version chain down from `id` to its current version.
  private async latestVersionOf(id: string) {
    let current = { id, version: 0 };
    for (;;) {
      const next = await this.database.livrable.findFirst({
        where: { parentVersionId: current.id },
        orderBy: { createdAt: 'desc' },
        select: { id: true, version: true },
      });
      if (!next) return current;
      current = next;
    }
  }

  /** The livrable; 409 INVALID_TRANSITION unless the event is allowed from its status. */
  private async requireEvent(id: string, event: LivrableEvent) {
    const livrable = await this.findOne(id);
    this.workflow.assertAllowed(LIVRABLE_STATES, livrable.status, event);
    return livrable;
  }

  // RG-DOS-007: no new livrable (or version) on a closed/archived dossier.
  // Also: no new livrable on a completed or cancelled task.
  private async assertInstructionDossierOpen(instructionId: string) {
    const instruction = await this.database.instruction.findUnique({
      where: { id: instructionId },
      select: { dossierId: true, status: true },
    });
    if (!instruction) {
      throw new NotFoundException(`Instruction ${instructionId} not found`);
    }
    if (TERMINAL_INSTRUCTION_STATUSES.includes(instruction.status)) {
      throw new BadRequestException(
        `Cannot create or modify a livrable on a ${instruction.status.toLowerCase()} task`,
      );
    }
    if (instruction.dossierId) {
      await assertDossierOpenForActivity(this.database, instruction.dossierId);
    }
  }
}
