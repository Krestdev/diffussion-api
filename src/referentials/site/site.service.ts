import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  Prisma,
  SiteStatus,
  UserStatus,
} from '../../../generated/prisma/client';
import { ActivityService } from '../../activity/activity.service';
import { AuditLog } from '../../activity/decorators/audit-log.decorator';
import { createWithUniqueReference } from '../../common/utils/generate-reference';
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
  constructor(
    private readonly database: DatabaseService,
    // Read by @AuditLog through `this.activity`.
    private readonly activity: ActivityService,
  ) {}

  @AuditLog({ action: 'site.created', entityType: 'site', operation: 'CREATE' })
  async create(dto: CreateSiteDto) {
    if (dto.responsibleId) {
      await this.assertEligibleResponsible(dto.responsibleId);
    }
    return createWithUniqueReference('ST', (code) =>
      this.database.$transaction(async (tx) => {
        const site = await tx.site.create({
          data: { ...dto, code },
          include: includeResponsible,
        });
        if (dto.responsibleId) {
          await this.ensureAssigned(tx, dto.responsibleId, site.id);
        }
        return site;
      }),
    );
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

  @AuditLog({ action: 'site.updated', entityType: 'site', operation: 'UPDATE' })
  async update(uuid: string, dto: UpdateSiteDto) {
    const site = await this.findOne(uuid);
    const newResponsibleId =
      dto.responsibleId && dto.responsibleId !== site.responsibleId
        ? dto.responsibleId
        : null;
    if (newResponsibleId) {
      await this.assertEligibleResponsible(newResponsibleId);
    }
    return this.database.$transaction(async (tx) => {
      if (newResponsibleId) {
        await this.ensureAssigned(tx, newResponsibleId, uuid);
      }
      return tx.site.update({
        where: { id: uuid },
        data: dto,
        include: includeResponsible,
      });
    });
  }

  // RG-SEC: deactivating a site freezes it for new activity (see
  // assertSiteActive) — modeled as a status toggle rather than deletion.
  @AuditLog({
    action: 'site.status-toggled',
    entityType: 'site',
    operation: 'UPDATE',
  })
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

  @AuditLog({ action: 'site.deleted', entityType: 'site', operation: 'DELETE' })
  async remove(uuid: string) {
    await this.findOne(uuid);
    const [dossiers, assignments] = await Promise.all([
      this.database.dossier.count({ where: { siteId: uuid } }),
      this.database.assignment.count({ where: { siteId: uuid } }),
    ]);
    if (dossiers > 0 || assignments > 0) {
      const blockers = [
        dossiers > 0 && `${dossiers} dossier(s)`,
        assignments > 0 && `${assignments} user assignment(s)`,
      ].filter(Boolean);
      throw new ConflictException(
        `Site still owns ${blockers.join(' and ')} — deactivate it instead, or move/remove those first`,
      );
    }
    await this.database.site.delete({ where: { id: uuid } });
  }

  // The site responsible gets authority over the site's courriers/documents
  // (owner assignment, ...), so it must be an active user.
  private async assertEligibleResponsible(userId: string) {
    const user = await this.database.user.findUnique({
      where: { id: userId },
      select: { status: true, name: true },
    });
    if (!user) {
      throw new BadRequestException(`User ${userId} not found`);
    }
    if (user.status !== UserStatus.ACTIVE) {
      throw new BadRequestException(
        `${user.name} is suspended and cannot be made site responsible`,
      );
    }
  }

  // A site responsible is necessarily attached to the site they manage —
  // circuit eligibility and notifications are resolved through assignments.
  private async ensureAssigned(
    tx: Prisma.TransactionClient,
    userId: string,
    siteId: string,
  ) {
    await tx.assignment.upsert({
      where: { userId_siteId: { userId, siteId } },
      update: {},
      create: { userId, siteId },
    });
  }
}
