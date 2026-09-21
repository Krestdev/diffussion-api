import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '../../../generated/prisma/client';
import { ActivityService } from '../../activity/activity.service';
import { AuditLog } from '../../activity/decorators/audit-log.decorator';
import { DatabaseService } from '../../database/database.service';
import { CreateCanalDto } from './dto/create-canal.dto';
import { UpdateCanalDto } from './dto/update-canal.dto';

@Injectable()
export class CanalService {
  constructor(
    private readonly database: DatabaseService,
    // Read by @AuditLog through `this.activity`.
    private readonly activity: ActivityService,
  ) {}

  @AuditLog({
    action: 'canal.created',
    entityType: 'canal',
    operation: 'CREATE',
  })
  async create(dto: CreateCanalDto) {
    return this.database.canal.create({ data: dto });
  }

  findAll() {
    return this.database.canal.findMany({ orderBy: { name: 'asc' } });
  }

  async findOne(id: string) {
    const canal = await this.database.canal.findUnique({ where: { id } });
    if (!canal) {
      throw new NotFoundException(`Canal ${id} not found`);
    }
    return canal;
  }

  @AuditLog({
    action: 'canal.updated',
    entityType: 'canal',
    operation: 'UPDATE',
  })
  async update(id: string, dto: UpdateCanalDto) {
    await this.findOne(id);
    return this.database.canal.update({ where: { id }, data: dto });
  }

  @AuditLog({
    action: 'canal.deleted',
    entityType: 'canal',
    operation: 'DELETE',
  })
  async remove(id: string) {
    await this.findOne(id);
    try {
      await this.database.canal.delete({ where: { id } });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2003'
      ) {
        throw new BadRequestException(
          'Canal is still referenced by one or more courriers',
        );
      }
      throw error;
    }
  }
}
