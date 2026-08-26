import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '../../../generated/prisma/client';
import { DatabaseService } from '../../database/database.service';
import { ActivityService } from '../../activity/activity.service';
import { AuditLog } from '../../activity/decorators/audit-log.decorator';
import { CreateServiceDto } from './dto/create-service.dto';
import { UpdateServiceDto } from './dto/update-service.dto';

@Injectable()
export class ServiceService {
  private readonly logger = new Logger(ServiceService.name);

  constructor(
    private readonly database: DatabaseService,
    private readonly activity: ActivityService,
  ) {}

  @AuditLog({
    action: 'service.created',
    entityType: 'service',
    operation: 'CREATE',
  })
  async create(dto: CreateServiceDto) {
    return this.database.service.create({ data: dto });
  }

  findAll() {
    return this.database.service.findMany({ orderBy: { name: 'asc' } });
  }

  async findOne(uuid: string) {
    const service = await this.database.service.findUnique({
      where: { id: uuid },
    });
    if (!service) {
      this.logger.warn(`Service not found: ${uuid}`, ServiceService.name);
      throw new NotFoundException(`Service ${uuid} not found`);
    }
    return service;
  }

  @AuditLog({
    action: 'service.updated',
    entityType: 'service',
    operation: 'UPDATE',
  })
  async update(uuid: string, dto: UpdateServiceDto) {
    return this.database.service.update({ where: { id: uuid }, data: dto });
  }

  @AuditLog({
    action: 'service.deleted',
    entityType: 'service',
    operation: 'DELETE',
  })
  async remove(uuid: string) {
    try {
      await this.database.service.delete({ where: { id: uuid } });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2003'
      ) {
        throw new BadRequestException(
          'Service is still assigned to one or more utilisateurs',
        );
      }
      throw error;
    }
  }
}
