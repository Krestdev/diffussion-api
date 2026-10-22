import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '../../../generated/prisma/client';
import { createWithUniqueReference } from '../../common/utils/generate-reference';
import { ActivityService } from '../../activity/activity.service';
import { AuditLog } from '../../activity/decorators/audit-log.decorator';
import { DatabaseService } from '../../database/database.service';
import { CreateCorrespondentDto } from './dto/create-correspondent.dto';
import { FindCorrespondantsQueryDto } from './dto/find-correspondents.query.dto';
import { UpdateCorrespondantDto } from './dto/update-correspondent.dto';

const includeType = {
  type: true,
} satisfies Prisma.CorrespondentInclude;

@Injectable()
export class CorrespondantService {
  constructor(
    private readonly database: DatabaseService,
    // Read by @AuditLog through `this.activity`.
    private readonly activity: ActivityService,
  ) {}

  @AuditLog({
    action: 'correspondent.created',
    entityType: 'correspondent',
    operation: 'CREATE',
  })
  async create(dto: CreateCorrespondentDto) {
    if (dto.typeId) await this.assertTypeExists(dto.typeId);
    return createWithUniqueReference('CP', (code) =>
      this.database.correspondent.create({
        data: { ...dto, code },
        include: includeType,
      }),
    );
  }

  async findAll(query: FindCorrespondantsQueryDto) {
    const contains = query.search
      ? { contains: query.search, mode: 'insensitive' as const }
      : undefined;
    const where: Prisma.CorrespondentWhereInput = {
      typeId: query.typeId,
      city: query.city
        ? { contains: query.city, mode: 'insensitive' }
        : undefined,
      status: query.status,
      OR: contains && [
        { name: contains },
        { code: contains },
        { email: contains },
        { phone: contains },
        { mainContact: contains },
      ],
    };

    const [data, total] = await this.database.$transaction([
      this.database.correspondent.findMany({
        where,
        include: includeType,
        orderBy: { name: 'asc' },
        skip: query.skip ?? 0,
        take: query.take ?? 20,
      }),
      this.database.correspondent.count({ where }),
    ]);

    return { data, total, skip: query.skip ?? 0, take: query.take ?? 20 };
  }

  async findOne(uuid: string) {
    const correspondent = await this.database.correspondent.findUnique({
      where: { id: uuid },
      include: includeType,
    });
    if (!correspondent) {
      throw new NotFoundException(`Correspondent ${uuid} not found`);
    }
    return correspondent;
  }

  @AuditLog({
    action: 'correspondent.updated',
    entityType: 'correspondent',
    operation: 'UPDATE',
  })
  async update(uuid: string, dto: UpdateCorrespondantDto) {
    await this.findOne(uuid);
    if (dto.typeId) await this.assertTypeExists(dto.typeId);
    return this.database.correspondent.update({
      where: { id: uuid },
      data: dto,
      include: includeType,
    });
  }

  @AuditLog({
    action: 'correspondent.deleted',
    entityType: 'correspondent',
    operation: 'DELETE',
  })
  async remove(uuid: string) {
    await this.findOne(uuid);
    try {
      await this.database.correspondent.delete({ where: { id: uuid } });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2003'
      ) {
        throw new BadRequestException(
          'Correspondent is still referenced by one or more courriers',
        );
      }
      throw error;
    }
  }

  private async assertTypeExists(typeId: string) {
    const type = await this.database.correspondentType.findUnique({
      where: { id: typeId },
      select: { id: true },
    });
    if (!type) {
      throw new BadRequestException(`Correspondent type ${typeId} not found`);
    }
  }
}
