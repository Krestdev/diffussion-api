import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '../../../generated/prisma/client';
import { ActivityService } from '../../activity/activity.service';
import { AuditLog } from '../../activity/decorators/audit-log.decorator';
import { DatabaseService } from '../../database/database.service';
import { CreateCourrierNatureDto } from './dto/create-courrier-nature.dto';
import { UpdateCourrierNatureDto } from './dto/update-courrier-nature.dto';
import {
  DEFAULT_TAKE,
  PaginationQueryDto,
} from '../../common/dto/pagination.query.dto';

@Injectable()
export class CourrierNatureService {
  constructor(
    private readonly database: DatabaseService,
    // Read by @AuditLog through `this.activity`.
    private readonly activity: ActivityService,
  ) {}

  @AuditLog({
    action: 'courrier-nature.created',
    entityType: 'courrier-nature',
    operation: 'CREATE',
  })
  async create(dto: CreateCourrierNatureDto) {
    return this.database.courrierNature.create({ data: dto });
  }

  async findAll(query: PaginationQueryDto = {}) {
    const where: Prisma.CourrierNatureWhereInput = {
      name: query.search
        ? { contains: query.search, mode: 'insensitive' }
        : undefined,
    };
    const skip = query.skip ?? 0;
    const take = query.take ?? DEFAULT_TAKE;

    const [data, total] = await this.database.$transaction([
      this.database.courrierNature.findMany({
        where,
        orderBy: { name: 'asc' },
        skip,
        take,
      }),
      this.database.courrierNature.count({ where }),
    ]);

    return { data, total, skip, take };
  }

  async findOne(id: string) {
    const nature = await this.database.courrierNature.findUnique({
      where: { id },
    });
    if (!nature) {
      throw new NotFoundException(`Courrier nature ${id} not found`);
    }
    return nature;
  }

  @AuditLog({
    action: 'courrier-nature.updated',
    entityType: 'courrier-nature',
    operation: 'UPDATE',
  })
  async update(id: string, dto: UpdateCourrierNatureDto) {
    await this.findOne(id);
    return this.database.courrierNature.update({ where: { id }, data: dto });
  }

  @AuditLog({
    action: 'courrier-nature.deleted',
    entityType: 'courrier-nature',
    operation: 'DELETE',
  })
  async remove(id: string) {
    await this.findOne(id);
    try {
      await this.database.courrierNature.delete({ where: { id } });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2003'
      ) {
        throw new BadRequestException(
          'Courrier nature is still referenced by one or more courriers',
        );
      }
      throw error;
    }
  }
}
