import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '../../../generated/prisma/client';
import { DatabaseService } from '../../database/database.service';
import { CreateCorrespondentDto } from './dto/create-correspondent.dto';
import { FindCorrespondantsQueryDto } from './dto/find-correspondents.query.dto';
import { UpdateCorrespondantDto } from './dto/update-correspondent.dto';

const includeType = {
  type: true,
} satisfies Prisma.CorrespondentInclude;

@Injectable()
export class CorrespondantService {
  constructor(private readonly database: DatabaseService) {}

  create(dto: CreateCorrespondentDto) {
    return this.database.correspondent.create({
      data: dto,
      include: includeType,
    });
  }

  async findAll(query: FindCorrespondantsQueryDto) {
    const where: Prisma.CorrespondentWhereInput = {
      typeId: query.typeId,
      city: query.city ? { contains: query.city, mode: 'insensitive' } : undefined,
      status: query.status,
      name: query.search
        ? { contains: query.search, mode: 'insensitive' }
        : undefined,
    };

    const [data, total] = await this.database.$transaction([
      this.database.correspondent.findMany({
        where,
        include: includeType,
        orderBy: { name: 'asc' },
        skip: query.skip ?? 0,
        take: query.take ?? 20,
      }),
      this.database.correspondent.count({ where }),
    ]);

    return { data, total, skip: query.skip ?? 0, take: query.take ?? 20 };
  }

  async findOne(uuid: string) {
    const correspondent = await this.database.correspondent.findUnique({
      where: { id: uuid },
      include: includeType,
    });
    if (!correspondent) {
      throw new NotFoundException(`Correspondent ${uuid} not found`);
    }
    return correspondent;
  }

  async update(uuid: string, dto: UpdateCorrespondantDto) {
    await this.findOne(uuid);
    return this.database.correspondent.update({
      where: { id: uuid },
      data: dto,
      include: includeType,
    });
  }

  async remove(uuid: string) {
    await this.findOne(uuid);
    try {
      await this.database.correspondent.delete({ where: { id: uuid } });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2003'
      ) {
        throw new BadRequestException(
          'Correspondent is still referenced by one or more courriers',
        );
      }
      throw error;
    }
  }
}
