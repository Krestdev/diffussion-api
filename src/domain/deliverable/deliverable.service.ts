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
import { PermissionCode } from '../../auth/rbac/rbac.constants';
import { RbacService } from '../../auth/rbac/rbac.service';
import { assertDossierOpenForActivity } from '../../common/utils/dossier-lifecycle';
import {
  lastLivrableValidation,
  withLivrableHistory,
} from '../../common/utils/livrable-history';
import { DatabaseService } from '../../database/database.service';
import { CreateDeliverableDto } from './dto/create-deliverable.dto';
import { FindDeliverableQueryDto } from './dto/find-deliverable-query.dto';
import { UpdateDeliverableDto } from './dto/update-deliverable.dto';

const deliverableInclude = {
  documents: true,
  versions: { orderBy: { version: 'asc' } },
  // Latest supervisor decision, with its motif when rejected.
  validations: lastLivrableValidation,
} satisfies Prisma.LivrableInclude;

// Each earlier version in `history`: its files and its decision.
const historyInclude = {
  documents: true,
  validations: lastLivrableValidation,
} satisfies Prisma.LivrableInclude;

const TERMINAL_INSTRUCTION_STATUSES: InstructionStatus[] = [
  InstructionStatus.TERMINEE,
  InstructionStatus.ANNULEE,
];

const SUBMITTABLE_INSTRUCTION_STATUSES: InstructionStatus[] = [
  InstructionStatus.EN_COURS,
  InstructionStatus.A_CORRIGER,
  InstructionStatus.EN_ATTENTE_VALIDATION,
];

@Injectable()
export class DeliverableService {
  constructor(
    private readonly database: DatabaseService,
    private readonly rbac: RbacService,
  ) {}

  async create(dto: CreateDeliverableDto, createdById: string) {
    await this.assertInstructionDossierOpen(dto.instructionId);
    return this.database.livrable.create({
      data: { ...dto, createdById },
      include: deliverableInclude,
    });
  }

  async findAll(query: FindDeliverableQueryDto, userId: string) {
    // One row per livrable: its current version, earlier ones in `history`.
    const where: Prisma.LivrableWhereInput = {
      isLatest: true,
      instructionId: query.instructionId,
      status: query.status,
      // Only the sites where the caller may read livrables.
      ...(await this.rbac.siteFilter(
        userId,
        PermissionCode.LivrableRead,
        (siteId): Prisma.LivrableWhereInput => ({
          instruction: { dossier: { siteId } },
        }),
      )),
    };

    const [data, total] = await this.database.$transaction([
      this.database.livrable.findMany({
        where,
        include: deliverableInclude,
        orderBy: { createdAt: 'desc' },
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
      return tx.livrable.create({
        data: {
          instructionId: parent.instructionId,
          title: dto.title ?? parent.title,
          description: dto.description ?? parent.description,
          version: parent.version + 1,
          parentVersionId: parent.id,
          createdById,
        },
        include: deliverableInclude,
      });
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

  async deposit(id: string) {
    const livrable = await this.requireStatus(id, [
      LivrableStatus.EN_PREPARATION,
    ]);
    return this.setStatus(livrable.id, LivrableStatus.DEPOSE);
  }

  // 10.5.4.4: once submitted, the parent instruction moves to
  // EN_ATTENTE_VALIDATION (from EN_COURS or A_CORRIGER, for a resubmission
  // after corrections).
  // Only while the instruction is being worked on or validated: a
  // livrable submitted on an instruction in any other state (AFFECTEE,
  // TERMINEE, ANNULEE...) would sit SOUMIS with nobody able to decide it.
  async submit(id: string) {
    const livrable = await this.requireStatus(id, [LivrableStatus.DEPOSE]);
    const instruction = await this.database.instruction.findUniqueOrThrow({
      where: { id: livrable.instructionId },
      select: { status: true },
    });
    if (!SUBMITTABLE_INSTRUCTION_STATUSES.includes(instruction.status)) {
      throw new BadRequestException(
        `Instruction is ${instruction.status} — livrables can only be submitted while it is ${SUBMITTABLE_INSTRUCTION_STATUSES.join(', ')}`,
      );
    }
    const [updated] = await this.database.$transaction([
      this.database.livrable.update({
        where: { id: livrable.id },
        data: { status: LivrableStatus.SOUMIS },
        include: deliverableInclude,
      }),
      this.database.instruction.updateMany({
        where: {
          id: livrable.instructionId,
          status: {
            in: [InstructionStatus.EN_COURS, InstructionStatus.A_CORRIGER],
          },
        },
        data: { status: InstructionStatus.EN_ATTENTE_VALIDATION },
      }),
    ]);
    return updated;
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

  private async requireStatus(id: string, allowed: LivrableStatus[]) {
    const livrable = await this.findOne(id);
    if (!allowed.includes(livrable.status)) {
      throw new BadRequestException(
        `Livrable is ${livrable.status}, expected one of: ${allowed.join(', ')}`,
      );
    }
    return livrable;
  }

  private setStatus(id: string, status: LivrableStatus) {
    return this.database.livrable.update({
      where: { id },
      data: { status },
      include: deliverableInclude,
    });
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
    await assertDossierOpenForActivity(this.database, instruction.dossierId);
  }
}
