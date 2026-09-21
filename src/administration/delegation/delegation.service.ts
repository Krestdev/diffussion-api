import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '../../../generated/prisma/client';
import {
  DEFAULT_TAKE,
  PaginationQueryDto,
} from '../../common/dto/pagination.query.dto';
import { DatabaseService } from '../../database/database.service';
import { CreateDelegationDto } from './dto/create-delegation.dto';
import { UpdateDelegationDto } from './dto/update-delegation.dto';

const include = {
  delegant: { select: { id: true, name: true } },
  delegataire: { select: { id: true, name: true } },
} satisfies Prisma.DelegationInclude;

@Injectable()
export class DelegationService {
  constructor(private readonly database: DatabaseService) {}

  create(dto: CreateDelegationDto) {
    return this.database.delegation.create({ data: dto, include });
  }

  async findAll(query: PaginationQueryDto) {
    const skip = query.skip ?? 0;
    const take = query.take ?? DEFAULT_TAKE;
    const where: Prisma.DelegationWhereInput = query.search
      ? {
          OR: [
            {
              responsibility: { contains: query.search, mode: 'insensitive' },
            },
            {
              delegant: {
                name: { contains: query.search, mode: 'insensitive' },
              },
            },
            {
              delegataire: {
                name: { contains: query.search, mode: 'insensitive' },
              },
            },
          ],
        }
      : {};
    const [data, total] = await this.database.$transaction([
      this.database.delegation.findMany({
        where,
        orderBy: { startDate: 'desc' },
        include,
        skip,
        take,
      }),
      this.database.delegation.count({ where }),
    ]);
    return { data, total, skip, take };
  }

  async findOne(id: string) {
    const delegation = await this.database.delegation.findUnique({
      where: { id },
      include,
    });
    if (!delegation) {
      throw new NotFoundException(`Delegation ${id} not found`);
    }
    return delegation;
  }

  async update(id: string, dto: UpdateDelegationDto) {
    await this.findOne(id);
    return this.database.delegation.update({
      where: { id },
      data: dto,
      include,
    });
  }

  async remove(id: string) {
    await this.findOne(id);
    await this.database.delegation.delete({ where: { id } });
  }
}
