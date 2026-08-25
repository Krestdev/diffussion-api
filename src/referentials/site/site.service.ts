import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, SiteStatus } from '../../../generated/prisma/client';
import { DatabaseService } from '../../database/database.service';
import { CreateSiteDto } from './dto/create-site.dto';
import { UpdateSiteDto } from './dto/update-site.dto';

const includeResponsible = {
  responsible: {
    select: { id: true, name: true, email: true },
  },
} satisfies Prisma.SiteInclude;

@Injectable()
export class SiteService {
  constructor(private readonly database: DatabaseService) {}

  create(dto: CreateSiteDto) {
    return this.database.site.create({
      data: dto,
      include: includeResponsible,
    });
  }

  findAll() {
    return this.database.site.findMany({
      orderBy: { name: 'asc' },
      include: includeResponsible,
    });
  }

  async findOne(uuid: string) {
    const site = await this.database.site.findUnique({
      where: { id: uuid },
      include: includeResponsible,
    });
    if (!site) {
      throw new NotFoundException(`Site ${uuid} not found`);
    }
    return site;
  }

  async update(uuid: string, dto: UpdateSiteDto) {
    await this.findOne(uuid);
    return this.database.site.update({
      where: { id: uuid },
      data: dto,
      include: includeResponsible,
    });
  }

  // RG-SEC: deactivating a site cuts off access for the employees attached
  // to it — modeled as a status toggle rather than deletion.
  async toggleStatus(uuid: string) {
    const site = await this.findOne(uuid);
    return this.database.site.update({
      where: { id: uuid },
      data: {
        status:
          site.status === SiteStatus.ACTIVE
            ? SiteStatus.INACTIVE
            : SiteStatus.ACTIVE,
      },
      include: includeResponsible,
    });
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
