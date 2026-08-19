import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '../../../generated/prisma/client';
import { DatabaseService } from '../../database/database.service';
import { CreateServiceDto } from './dto/create-service.dto';
import { UpdateServiceDto } from './dto/update-service.dto';

@Injectable()
export class ServiceService {
  constructor(private readonly database: DatabaseService) {}

  create(dto: CreateServiceDto) {
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
      throw new NotFoundException(`Service ${uuid} not found`);
    }
    return service;
  }

  async update(uuid: string, dto: UpdateServiceDto) {
    await this.findOne(uuid);
    return this.database.service.update({ where: { id: uuid }, data: dto });
  }

  async remove(uuid: string) {
    await this.findOne(uuid);
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
