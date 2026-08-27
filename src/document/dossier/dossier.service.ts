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
import { SetAccessDto } from '../../common/dto/access.dto';
import { createWithUniqueReference } from '../../common/utils/generate-reference';
import { DatabaseService } from '../../database/database.service';
import { CreateDossierDto } from './dto/create-dossier.dto';
import { FindDossiersQueryDto } from './dto/find-dossiers.query.dto';
import { UpdateDossierDto } from './dto/update-dossier.dto';

const dossierInclude = {
  site: true,
  type: true,
  category: true,
  project: true,
  responsible: { select: { id: true, name: true, email: true } },
  createdBy: { select: { id: true, name: true, email: true } },
  _count: { select: { courriers: true, instructions: true } },
} satisfies Prisma.DossierInclude;

const dossierAccessInclude = {
  user: { select: { id: true, name: true, email: true } },
} satisfies Prisma.DossierAccessInclude;

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

  // Inverse of archive() — brings a dossier back to CLOSED (not straight to
  // IN_PROGRESS: archiving only ever happens from CLOSED, so this undoes
  // exactly that step; a further reopen() can resume active work from there).
  async unarchive(id: string) {
    const dossier = await this.findOne(id);
    if (dossier.status !== DossierStatus.ARCHIVED) {
      throw new BadRequestException('Only an archived dossier can be restored');
    }
    return this.database.dossier.update({
      where: { id },
      data: { status: DossierStatus.CLOSED, archivedAt: null },
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
  // `userId`/`actorLabel` on ActivityLog are loose references rather than a
  // relation (see schema), so there's no join to include here.
  async getHistorique(id: string) {
    await this.findOne(id);
    return this.database.activityLog.findMany({
      where: { entityType: 'Dossier', entityId: id },
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

  // RG-DOS-*: explicit per-user grants on top of `confidentiality` — a
  // RESTRICTED dossier is otherwise only visible to its responsible/creator.
  async getAccess(id: string) {
    await this.findOne(id);
    return this.database.dossierAccess.findMany({
      where: { dossierId: id },
      include: dossierAccessInclude,
      orderBy: { createdAt: 'asc' },
    });
  }

  // Full-replace: the entries given become the complete grant set for this
  // dossier — any existing grant for a user not listed is dropped.
  async setAccess(id: string, dto: SetAccessDto) {
    await this.findOne(id);
    const userIds = dto.entries.map((entry) => entry.userId);

    await this.database.$transaction([
      this.database.dossierAccess.deleteMany({
        where: {
          dossierId: id,
          userId: { notIn: userIds.length > 0 ? userIds : ['__none__'] },
        },
      }),
      ...dto.entries.map((entry) =>
        this.database.dossierAccess.upsert({
          where: { dossierId_userId: { dossierId: id, userId: entry.userId } },
          create: {
            dossierId: id,
            userId: entry.userId,
            canView: entry.canView,
            canEdit: entry.canEdit,
          },
          update: { canView: entry.canView, canEdit: entry.canEdit },
        }),
      ),
    ]);

    return this.getAccess(id);
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
