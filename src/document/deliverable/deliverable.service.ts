import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import {
  InstructionStatus,
  LivrableStatus,
  Prisma,
} from '../../../generated/prisma/client';
import { DatabaseService } from '../../database/database.service';
import { CreateDeliverableDto } from './dto/create-deliverable.dto';
import { FindDeliverableQueryDto } from './dto/find-deliverable-query.dto';
import { UpdateDeliverableDto } from './dto/update-deliverable.dto';

const deliverableInclude = {
  documents: true,
  versions: { orderBy: { version: 'asc' } },
} satisfies Prisma.LivrableInclude;

@Injectable()
export class DeliverableService {
  constructor(private readonly database: DatabaseService) {}

  create(dto: CreateDeliverableDto, createdById: string) {
    return this.database.livrable.create({
      data: { ...dto, createdById },
      include: deliverableInclude,
    });
  }

  async findAll(query: FindDeliverableQueryDto) {
    const where: Prisma.LivrableWhereInput = {
      instructionId: query.instructionId,
      status: query.status,
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

    return { data, total, skip: query.skip ?? 0, take: query.take ?? 20 };
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

  async newVersion(id: string, dto: UpdateDeliverableDto, createdById: string) {
    const parent = await this.findOne(id);
    return this.database.livrable.create({
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
  async submit(id: string) {
    const livrable = await this.requireStatus(id, [LivrableStatus.DEPOSE]);
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
}
