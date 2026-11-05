import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
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
import { PermissionCode } from '../../auth/rbac/rbac.constants';
import { assertInScope, RbacService } from '../../auth/rbac/rbac.service';
import { createWithUniqueReference } from '../../common/utils/generate-reference';
import { DatabaseService } from '../../database/database.service';
import { CreateSiteDto } from './dto/create-site.dto';
import { UpdateSiteDto } from './dto/update-site.dto';
import { DEFAULT_TAKE } from '../../common/dto/pagination.query.dto';
import { FindSitesQueryDto } from './dto/find-sites.query.dto';

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
    private readonly rbac: RbacService,
  ) {}

  @AuditLog({ action: 'site.created', entityType: 'site', operation: 'CREATE' })
  async create(dto: CreateSiteDto) {
    if (dto.responsibleId) {
      await this.assertEligibleResponsible(dto.responsibleId, null);
    }
    return createWithUniqueReference('ST', (code) =>
      this.database.$transaction(async (tx) => {
        const site = await tx.site.create({
          data: { ...dto, code },
          include: includeResponsible,
        });
        if (dto.responsibleId) {
          await this.moveIntoSite(tx, dto.responsibleId, site.id);
        }
        // Every site has its own analysis criteria: a copy of the common
        // model, which it then adapts.
        const model = await tx.analysisCriterionTemplate.findMany({
          where: { siteId: null },
          select: {
            label: true,
            description: true,
            order: true,
            isActive: true,
            appliedByDefault: true,
          },
        });
        if (model.length) {
          await tx.analysisCriterionTemplate.createMany({
            data: model.map((criterion) => ({ ...criterion, siteId: site.id })),
          });
        }
        return site;
      }),
    );
  }

  async findAll(query: FindSitesQueryDto = {}) {
    const contains = query.search
      ? { contains: query.search, mode: 'insensitive' as const }
      : undefined;
    const where: Prisma.SiteWhereInput = {
      status: query.status,
      responsibleId: query.responsibleId,
      city: query.city
        ? { contains: query.city, mode: 'insensitive' }
        : undefined,
      OR: contains && [
        { name: contains },
        { code: contains },
        { city: contains },
        { responsible: { name: contains } },
      ],
    };
    const skip = query.skip ?? 0;
    const take = query.take ?? DEFAULT_TAKE;

    const [data, total] = await this.database.$transaction([
      this.database.site.findMany({
        where,
        orderBy: { name: 'asc' },
        include: includeResponsible,
        skip,
        take,
      }),
      this.database.site.count({ where }),
    ]);

    return { data, total, skip, take };
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
  async update(uuid: string, dto: UpdateSiteDto, actingUserId: string) {
    const scope = await this.rbac.administeredSites(
      actingUserId,
      PermissionCode.AdminManageSites,
    );
    assertInScope(scope, uuid);
    const site = await this.findOne(uuid);
    const newResponsibleId =
      dto.responsibleId && dto.responsibleId !== site.responsibleId
        ? dto.responsibleId
        : null;
    if (newResponsibleId) {
      // Naming the responsible names the site's administrator.
      if (scope !== 'ALL') {
        throw new ForbiddenException(
          "Only a platform administrator can change a site's responsible",
        );
      }
      await this.assertEligibleResponsible(newResponsibleId, uuid);
    }
    return this.database.$transaction(async (tx) => {
      if (newResponsibleId) {
        await this.moveIntoSite(tx, newResponsibleId, uuid);
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
    const [dossiers, users] = await Promise.all([
      this.database.dossier.count({ where: { siteId: uuid } }),
      this.database.user.count({ where: { siteId: uuid } }),
    ]);
    if (dossiers > 0 || users > 0) {
      const blockers = [
        dossiers > 0 && `${dossiers} dossier(s)`,
        users > 0 && `${users} user(s)`,
      ].filter(Boolean);
      throw new ConflictException(
        `Site still owns ${blockers.join(' and ')} — deactivate it instead, or move/remove those first`,
      );
    }
    // Nobody can use the site's own roles and effet types any more: they go
    // with it.
    await this.database.$transaction([
      this.database.rolePermission.deleteMany({
        where: { role: { siteId: uuid } },
      }),
      this.database.role.deleteMany({ where: { siteId: uuid } }),
      this.database.effetType.deleteMany({ where: { siteId: uuid } }),
      this.database.site.delete({ where: { id: uuid } }),
    ]);
  }

  // The responsible is the site's administrator (users, delegations, audit
  // of that site — see RbacService.administeredSites): an active user, not
  // a platform user, and responsible of no other site. `siteId` is the site
  // they will manage (null while it's being created).
  private async assertEligibleResponsible(
    userId: string,
    siteId: string | null,
  ) {
    const user = await this.database.user.findUnique({
      where: { id: userId },
      select: {
        status: true,
        name: true,
        siteId: true,
        managedSites: { select: { id: true, name: true } },
      },
    });
    if (!user) {
      throw new BadRequestException(`User ${userId} not found`);
    }
    if (user.status !== UserStatus.ACTIVE) {
      throw new BadRequestException(
        `${user.name} is suspended and cannot be made site responsible`,
      );
    }
    if (user.siteId === null) {
      throw new BadRequestException(
        `${user.name} is a platform administrator and cannot be a site responsible`,
      );
    }
    const other = user.managedSites.find((managed) => managed.id !== siteId);
    if (other) {
      throw new BadRequestException(
        `${user.name} is already the responsible of site "${other.name}"`,
      );
    }
  }

  // A site's responsible belongs to it: someone from another site moves in,
  // with their global roles — the former site's own roles stay behind.
  // Delegations they gave or received at their former site no longer apply
  // there.
  private async moveIntoSite(
    tx: Prisma.TransactionClient,
    userId: string,
    siteId: string,
  ) {
    const user = await tx.user.findUniqueOrThrow({
      where: { id: userId },
      select: { siteId: true },
    });
    if (user.siteId === siteId) return;
    await tx.delegation.deleteMany({
      where: {
        siteId: user.siteId ?? undefined,
        OR: [{ delegantId: userId }, { delegataireId: userId }],
      },
    });
    await tx.userRole.deleteMany({
      where: { userId, role: { siteId: { not: null } } },
    });
    await tx.userRole.updateMany({ where: { userId }, data: { siteId } });
    await tx.user.update({ where: { id: userId }, data: { siteId } });
  }
}
