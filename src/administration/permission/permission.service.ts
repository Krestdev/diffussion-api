import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '../../../generated/prisma/client';
import { DatabaseService } from '../../database/database.service';
import { CreatePermissionDto } from './dto/create-permission.dto';
import { UpdatePermissionDto } from './dto/update-permission.dto';

@Injectable()
export class PermissionService {
  constructor(private readonly database: DatabaseService) {}

  create(dto: CreatePermissionDto) {
    return this.database.permission.create({ data: dto });
  }

  findAll() {
    return this.database.permission.findMany({ orderBy: { code: 'asc' } });
  }

  async findOne(id: string) {
    const permission = await this.database.permission.findUnique({
      where: { id },
    });
    if (!permission) {
      throw new NotFoundException(`Permission ${id} not found`);
    }
    return permission;
  }

  async update(id: string, dto: UpdatePermissionDto) {
    await this.findOne(id);
    return this.database.permission.update({ where: { id }, data: dto });
  }

  async remove(id: string) {
    await this.findOne(id);
    try {
      await this.database.permission.delete({ where: { id } });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2003'
      ) {
        throw new BadRequestException(
          'Permission is still granted to one or more roles',
        );
      }
      throw error;
    }
  }
}
