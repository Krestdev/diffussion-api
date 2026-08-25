import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  DossierStatus,
  InstructionStatus,
  Prisma,
} from '../../../generated/prisma/client';
import { createWithUniqueReference } from '../../common/utils/generate-reference';
import { DatabaseService } from '../../database/database.service';
import { CreateDossierDto } from './dto/create-dossier.dto';
import { FindDossiersQueryDto } from './dto/find-dossiers.query.dto';
import { UpdateDossierDto } from './dto/update-dossier.dto';

const dossierInclude = {
  site: true,
  type: true,
  category: true,
  responsible: { select: { id: true, name: true, email: true } },
  createdBy: { select: { id: true, name: true, email: true } },
  _count: { select: { courriers: true, instructions: true } },
} satisfies Prisma.DossierInclude;

const TERMINAL_INSTRUCTION_STATUSES: InstructionStatus[] = [
  InstructionStatus.TERMINEE,
  InstructionStatus.ANNULEE,
];

@Injectable()
export class DossierService {
  constructor(private readonly database: DatabaseService) {}

  create(dto: CreateDossierDto, createdById: string) {
    const { keywords, responsibleId, ...data } = dto;
    return createWithUniqueReference('D', (number) =>
      this.database.dossier.create({
        data: {
          ...data,
          number,
          keywords: keywords ?? [],
          responsibleId: responsibleId ?? createdById,
          createdById,
        },
        include: dossierInclude,
      }),
    );
  }

  async findAll(query: FindDossiersQueryDto) {
    const where: Prisma.DossierWhereInput = {
      status: query.status,
      priority: query.priority,
      siteId: query.siteId,
      responsibleId: query.responsibleId,
      OR: query.search
        ? [
            { title: { contains: query.search, mode: 'insensitive' } },
            { number: { contains: query.search, mode: 'insensitive' } },
          ]
        : undefined,
    };

    const [data, total] = await this.database.$transaction([
      this.database.dossier.findMany({
        where,
        include: dossierInclude,
        orderBy: { createdAt: 'desc' },
        skip: query.skip ?? 0,
        take: query.take ?? 20,
      }),
      this.database.dossier.count({ where }),
    ]);

    return { data, total, skip: query.skip ?? 0, take: query.take ?? 20 };
  }

  async findOne(id: string) {
    const dossier = await this.database.dossier.findUnique({
      where: { id },
      include: dossierInclude,
    });
    if (!dossier) {
      throw new NotFoundException(`Dossier ${id} not found`);
    }
    return dossier;
  }

  async update(id: string, dto: UpdateDossierDto) {
    await this.ensureMutable(id);
    const { keywords, ...data } = dto;
    return this.database.dossier.update({
      where: { id },
      data: { ...data, keywords },
      include: dossierInclude,
    });
  }

  // RG-DOS-005: a dossier can only close once every instruction attached to
  // it is terminated (validated) or cancelled.
  async close(id: string) {
    await this.ensureMutable(id);

    const pending = await this.database.instruction.count({
      where: {
        dossierId: id,
        status: { notIn: TERMINAL_INSTRUCTION_STATUSES },
      },
    });
    if (pending > 0) {
      throw new BadRequestException(
        `${pending} instruction(s) are still open — a dossier can only be closed once every instruction is terminated or cancelled`,
      );
    }

    return this.database.dossier.update({
      where: { id },
      data: { status: DossierStatus.CLOSED, closedAt: new Date() },
      include: dossierInclude,
    });
  }

  // RG-DOS-008: reopening is described as an exceptional procedure decided
  // outside the platform — exposed here as a distinct, separately
  // permissioned action rather than a plain field update.
  async reopen(id: string) {
    const dossier = await this.findOne(id);
    if (dossier.status !== DossierStatus.CLOSED) {
      throw new BadRequestException('Only a closed dossier can be reopened');
    }
    return this.database.dossier.update({
      where: { id },
      data: {
        status: DossierStatus.IN_PROGRESS,
        closedAt: null,
        archivedAt: null,
      },
      include: dossierInclude,
    });
  }

  // 10.8.3: a dossier must be closed before it is eligible for archiving.
  async archive(id: string) {
    const dossier = await this.findOne(id);
    if (dossier.status !== DossierStatus.CLOSED) {
      throw new BadRequestException('Only a closed dossier can be archived');
    }
    return this.database.dossier.update({
      where: { id },
      data: { status: DossierStatus.ARCHIVED, archivedAt: new Date() },
      include: dossierInclude,
    });
  }

  async getCourriers(id: string) {
    await this.findOne(id);
    return this.database.courrier.findMany({
      where: { dossierId: id },
      include: { correspondent: true },
      orderBy: { createdAt: 'desc' },
    });
  }

  async getInstructions(id: string) {
    await this.findOne(id);
    return this.database.instruction.findMany({
      where: { dossierId: id },
      include: { assignees: { include: { user: true } } },
      orderBy: { createdAt: 'desc' },
    });
  }

  async getLivrables(id: string) {
    await this.findOne(id);
    return this.database.livrable.findMany({
      where: { instruction: { dossierId: id } },
      orderBy: { createdAt: 'desc' },
    });
  }

  // RG-AUD-*: full trail of everything recorded against this dossier.
  async getHistorique(id: string) {
    await this.findOne(id);
    return this.database.auditLog.findMany({
      where: { entityType: 'Dossier', entityId: id },
      include: { user: { select: { id: true, name: true } } },
      orderBy: { createdAt: 'desc' },
    });
  }

  // 10.1.8: progression derived from how many attached instructions are
  // terminated. Persisted on the dossier so listings stay cheap to render.
  async getProgression(id: string) {
    await this.findOne(id);
    const [total, done] = await this.database.$transaction([
      this.database.instruction.count({ where: { dossierId: id } }),
      this.database.instruction.count({
        where: { dossierId: id, status: InstructionStatus.TERMINEE },
      }),
    ]);
    const progress = total === 0 ? 0 : Math.round((done / total) * 100);

    await this.database.dossier.update({ where: { id }, data: { progress } });

    return { total, done, progress };
  }

  private async ensureMutable(id: string) {
    const dossier = await this.findOne(id);
    if (
      dossier.status === DossierStatus.CLOSED ||
      dossier.status === DossierStatus.ARCHIVED
    ) {
      // RG-DOS-007
      throw new BadRequestException(
        `Dossier is ${dossier.status.toLowerCase()} and can only be consulted`,
      );
    }
    return dossier;
  }
}
