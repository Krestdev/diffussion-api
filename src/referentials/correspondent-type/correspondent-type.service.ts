import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '../../../generated/prisma/client';
import { ActivityService } from '../../activity/activity.service';
import { AuditLog } from '../../activity/decorators/audit-log.decorator';
import { DatabaseService } from '../../database/database.service';
import { CreateCorrespondentTypeDto } from './dto/create-correspondent-type.dto';
import { UpdateCorrespondentTypeDto } from './dto/update-correspondent-type.dto';
import {
  DEFAULT_TAKE,
  PaginationQueryDto,
} from '../../common/dto/pagination.query.dto';

@Injectable()
export class CorrespondentTypeService {
  constructor(
    private readonly database: DatabaseService,
    // Read by @AuditLog through `this.activity`.
    private readonly activity: ActivityService,
  ) {}

  @AuditLog({
    action: 'correspondent-type.created',
    entityType: 'correspondent-type',
    operation: 'CREATE',
  })
  async create(dto: CreateCorrespondentTypeDto) {
    return this.database.correspondentType.create({ data: dto });
  }

  async findAll(query: PaginationQueryDto = {}) {
    const where: Prisma.CorrespondentTypeWhereInput = {
      name: query.search
        ? { contains: query.search, mode: 'insensitive' }
        : undefined,
    };
    const skip = query.skip ?? 0;
    const take = query.take ?? DEFAULT_TAKE;

    const [data, total] = await this.database.$transaction([
      this.database.correspondentType.findMany({
        where,
        orderBy: { name: 'asc' },
        skip,
        take,
      }),
      this.database.correspondentType.count({ where }),
    ]);

    return { data, total, skip, take };
  }

  async findOne(id: string) {
    const type = await this.database.correspondentType.findUnique({
      where: { id },
    });
    if (!type) {
      throw new NotFoundException(`Correspondent type ${id} not found`);
    }
    return type;
  }

  @AuditLog({
    action: 'correspondent-type.updated',
    entityType: 'correspondent-type',
    operation: 'UPDATE',
  })
  async update(id: string, dto: UpdateCorrespondentTypeDto) {
    await this.findOne(id);
    return this.database.correspondentType.update({
      where: { id },
      data: dto,
    });
  }

  @AuditLog({
    action: 'correspondent-type.deleted',
    entityType: 'correspondent-type',
    operation: 'DELETE',
  })
  async remove(id: string) {
    await this.findOne(id);
    try {
      await this.database.correspondentType.delete({ where: { id } });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2003'
      ) {
        throw new BadRequestException(
          'Correspondent type is still referenced by one or more correspondents',
        );
      }
      throw error;
    }
  }
}
