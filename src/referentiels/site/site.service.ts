import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '../../../generated/prisma/client';
import { DatabaseService } from '../../database/database.service';
import { CreateSiteDto } from './dto/create-site.dto';
import { UpdateSiteDto } from './dto/update-site.dto';

@Injectable()
export class SiteService {
  constructor(private readonly database: DatabaseService) {}

  create(dto: CreateSiteDto) {
    return this.database.site.create({ data: dto });
  }

  findAll() {
    return this.database.site.findMany({ orderBy: { name: 'asc' } });
  }

  async findOne(uuid: string) {
    const site = await this.database.site.findUnique({ where: { id: uuid } });
    if (!site) {
      throw new NotFoundException(`Site ${uuid} not found`);
    }
    return site;
  }

  async update(uuid: string, dto: UpdateSiteDto) {
    await this.findOne(uuid);
    return this.database.site.update({ where: { id: uuid }, data: dto });
  }

  async remove(uuid: string) {
    await this.findOne(uuid);
    try {
      await this.database.site.delete({ where: { id: uuid } });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2003'
      ) {
        throw new BadRequestException(
          'Site is still referenced by one or more affectations',
        );
      }
      throw error;
    }
  }
}
