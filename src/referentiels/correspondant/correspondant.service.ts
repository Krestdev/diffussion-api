import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '../../../generated/prisma/client';
import { DatabaseService } from '../../database/database.service';
import { CreateCorrespondantDto } from './dto/create-correspondant.dto';
import { FindCorrespondantsQueryDto } from './dto/find-correspondants.query.dto';
import { UpdateCorrespondantDto } from './dto/update-correspondant.dto';

@Injectable()
export class CorrespondantService {
  constructor(private readonly database: DatabaseService) {}

  create(dto: CreateCorrespondantDto) {
    return this.database.correspondant.create({ data: dto });
  }

  findAll(query: FindCorrespondantsQueryDto) {
    const where: Prisma.CorrespondantWhereInput = {
      type: query.type,
      town: query.ville,
      status: query.status,
    };

    return this.database.correspondant.findMany({
      where,
      orderBy: { name: 'asc' },
      skip: query.skip ?? 0,
      take: query.take ?? 20,
    });
  }

  async findOne(uuid: string) {
    const correspondant = await this.database.correspondant.findUnique({
      where: { id: uuid },
    });
    if (!correspondant) {
      throw new NotFoundException(`Correspondant ${uuid} not found`);
    }
    return correspondant;
  }

  async update(uuid: string, dto: UpdateCorrespondantDto) {
    await this.findOne(uuid);
    return this.database.correspondant.update({
      where: { id: uuid },
      data: dto,
    });
  }

  async remove(uuid: string) {
    await this.findOne(uuid);
    await this.database.correspondant.delete({ where: { id: uuid } });
  }
}
