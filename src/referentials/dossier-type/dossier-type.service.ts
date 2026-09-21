import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '../../../generated/prisma/client';
import { ActivityService } from '../../activity/activity.service';
import { AuditLog } from '../../activity/decorators/audit-log.decorator';
import { DatabaseService } from '../../database/database.service';
import { CreateDossierTypeDto } from './dto/create-dossier-type.dto';
import { UpdateDossierTypeDto } from './dto/update-dossier-type.dto';

@Injectable()
export class DossierTypeService {
  constructor(
    private readonly database: DatabaseService,
    // Read by @AuditLog through `this.activity`.
    private readonly activity: ActivityService,
  ) {}

  @AuditLog({
    action: 'dossier-type.created',
    entityType: 'dossier-type',
    operation: 'CREATE',
  })
  async create(dto: CreateDossierTypeDto) {
    return this.database.dossierType.create({ data: dto });
  }

  findAll() {
    return this.database.dossierType.findMany({ orderBy: { name: 'asc' } });
  }

  async findOne(id: string) {
    const dossierType = await this.database.dossierType.findUnique({
      where: { id },
    });
    if (!dossierType) {
      throw new NotFoundException(`Dossier type ${id} not found`);
    }
    return dossierType;
  }

  @AuditLog({
    action: 'dossier-type.updated',
    entityType: 'dossier-type',
    operation: 'UPDATE',
  })
  async update(id: string, dto: UpdateDossierTypeDto) {
    await this.findOne(id);
    return this.database.dossierType.update({ where: { id }, data: dto });
  }

  @AuditLog({
    action: 'dossier-type.deleted',
    entityType: 'dossier-type',
    operation: 'DELETE',
  })
  async remove(id: string) {
    await this.findOne(id);
    try {
      await this.database.dossierType.delete({ where: { id } });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2003'
      ) {
        throw new BadRequestException(
          'Dossier type is still referenced by one or more dossiers',
        );
      }
      throw error;
    }
  }
}
