import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '../../../generated/prisma/client';
import { DatabaseService } from '../../database/database.service';
import { CreateCourrierNatureDto } from './dto/create-courrier-nature.dto';
import { UpdateCourrierNatureDto } from './dto/update-courrier-nature.dto';

@Injectable()
export class CourrierNatureService {
  constructor(private readonly database: DatabaseService) {}

  create(dto: CreateCourrierNatureDto) {
    return this.database.courrierNature.create({ data: dto });
  }

  findAll() {
    return this.database.courrierNature.findMany({
      orderBy: { name: 'asc' },
    });
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

  async update(id: string, dto: UpdateCourrierNatureDto) {
    await this.findOne(id);
    return this.database.courrierNature.update({ where: { id }, data: dto });
  }

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
