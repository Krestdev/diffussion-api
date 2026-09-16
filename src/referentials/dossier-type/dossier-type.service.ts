import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '../../../generated/prisma/client';
import { DatabaseService } from '../../database/database.service';
import { PaginationQueryDto } from '../../common/dto/pagination.dto';
import { CreateDossierTypeDto } from './dto/create-dossier-type.dto';
import { UpdateDossierTypeDto } from './dto/update-dossier-type.dto';

@Injectable()
export class DossierTypeService {
  constructor(private readonly database: DatabaseService) {}

  create(dto: CreateDossierTypeDto) {
    return this.database.dossierType.create({ data: dto });
  }

  async findAll(query: PaginationQueryDto) {
    const skip = query.skip ?? 0;
    const take = query.take ?? 20;
    const [data, total] = await this.database.$transaction([
      this.database.dossierType.findMany({
        orderBy: { name: 'asc' },
        skip,
        take,
      }),
      this.database.dossierType.count(),
    ]);
    return { data, total, skip, take };
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

  async update(id: string, dto: UpdateDossierTypeDto) {
    await this.findOne(id);
    return this.database.dossierType.update({ where: { id }, data: dto });
  }

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
