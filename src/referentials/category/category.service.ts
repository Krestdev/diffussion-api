import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '../../../generated/prisma/client';
import { ActivityService } from '../../activity/activity.service';
import { AuditLog } from '../../activity/decorators/audit-log.decorator';
import { DatabaseService } from '../../database/database.service';
import { CreateCategoryDto } from './dto/create-category.dto';
import { UpdateCategoryDto } from './dto/update-category.dto';

@Injectable()
export class CategoryService {
  constructor(
    private readonly database: DatabaseService,
    // Read by @AuditLog through `this.activity`.
    private readonly activity: ActivityService,
  ) {}

  @AuditLog({
    action: 'category.created',
    entityType: 'category',
    operation: 'CREATE',
  })
  async create(dto: CreateCategoryDto) {
    return this.database.category.create({ data: dto });
  }

  findAll() {
    return this.database.category.findMany({ orderBy: { label: 'asc' } });
  }

  async findOne(id: string) {
    const category = await this.database.category.findUnique({
      where: { id },
    });
    if (!category) {
      throw new NotFoundException(`Category ${id} not found`);
    }
    return category;
  }

  @AuditLog({
    action: 'category.updated',
    entityType: 'category',
    operation: 'UPDATE',
  })
  async update(id: string, dto: UpdateCategoryDto) {
    await this.findOne(id);
    return this.database.category.update({ where: { id }, data: dto });
  }

  @AuditLog({
    action: 'category.deleted',
    entityType: 'category',
    operation: 'DELETE',
  })
  async remove(id: string) {
    await this.findOne(id);
    try {
      await this.database.category.delete({ where: { id } });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2003'
      ) {
        throw new BadRequestException(
          'Category is still referenced by one or more dossiers',
        );
      }
      throw error;
    }
  }
}
