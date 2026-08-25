import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '../../../generated/prisma/client';
import { DatabaseService } from '../../database/database.service';
import { CreateCorrespondentTypeDto } from './dto/create-correspondent-type.dto';
import { UpdateCorrespondentTypeDto } from './dto/update-correspondent-type.dto';

@Injectable()
export class CorrespondentTypeService {
  constructor(private readonly database: DatabaseService) {}

  create(dto: CreateCorrespondentTypeDto) {
    return this.database.correspondentType.create({ data: dto });
  }

  findAll() {
    return this.database.correspondentType.findMany({
      orderBy: { name: 'asc' },
    });
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

  async update(id: string, dto: UpdateCorrespondentTypeDto) {
    await this.findOne(id);
    return this.database.correspondentType.update({
      where: { id },
      data: dto,
    });
  }

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
