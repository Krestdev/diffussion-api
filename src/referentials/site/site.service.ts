import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, UserStatus } from '../../../generated/prisma/client';
import { ActivityService } from '../../activity/activity.service';
import { AuditLog } from '../../activity/decorators/audit-log.decorator';
import { PermissionCode } from '../../auth/rbac/rbac.constants';
import { assertInScope, RbacService } from '../../auth/rbac/rbac.service';
import { generateReference } from '../../common/utils/generate-reference';
import { DEFAULT_SITE_ROLES } from './default-site-roles';
import { DatabaseService } from '../../database/database.service';
import { UpdateSiteDto } from './dto/update-site.dto';
import { DEFAULT_TAKE } from '../../common/dto/pagination.query.dto';
import { FindSitesQueryDto } from './dto/find-sites.query.dto';

const includeResponsible = {
  responsible: {
    select: { id: true, name: true, email: true },
  },
} satisfies Prisma.SiteInclude;

/**
 * What every new site starts with (created here or from the core's directory): its own analysis
 * criteria, a copy of the common model it then adapts, and its default roles (Admin,
 * Réceptionniste, Dispatcher, Admin dispatcher). `adminId` (its responsible) holds Admin.
 */
export async function setUpSite(
  tx: Prisma.TransactionClient,
  siteId: string,
  adminId: string | null,
): Promise<void> {
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
      data: model.map((criterion) => ({ ...criterion, siteId })),
    });
  }
  const permissions = await tx.permission.findMany({
    select: { id: true, code: true },
  });
  const idOf = new Map(permissions.map((p) => [p.code, p.id]));
  for (const role of DEFAULT_SITE_ROLES) {
    const created = await tx.role.create({
      data: {
        code: generateReference('RO'),
        name: role.name,
        description: role.description,
        siteId,
        rolePermissions: {
          create: role.permissions
            .filter((code) => idOf.has(code))
            .map((code) => ({ permissionId: idOf.get(code)! })),
        },
      },
      select: { id: true },
    });
    if (role.forResponsible && adminId) {
      await tx.userRole.createMany({
        data: [{ userId: adminId, roleId: created.id, siteId }],
        skipDuplicates: true,
      });
    }
  }
}

/** The site's own Admin role (DEFAULT_SITE_ROLES' `forResponsible` one), if it still has it. */
export async function siteAdminRoleId(
  tx: Prisma.TransactionClient,
  siteId: string,
): Promise<string | null> {
  const name = DEFAULT_SITE_ROLES.find((role) => role.forResponsible)?.name;
  if (!name) return null;
  const role = await tx.role.findFirst({
    where: { siteId, name, archivedAt: null },
    select: { id: true },
  });
  return role?.id ?? null;
}

@Injectable()
export class SiteService {
  constructor(
    private readonly database: DatabaseService,
    // Read by @AuditLog through `this.activity`.
    private readonly activity: ActivityService,
    private readonly rbac: RbacService,
  ) {}

  // The whole list for the platform; otherwise the user's own site, the one
  // they are responsible of, and those delegated to them.
  private async visibleTo(userId: string): Promise<Prisma.SiteWhereInput> {
    const [sites, dashboards] = await Promise.all([
      this.rbac.hasGlobalPermission(userId, PermissionCode.AdminManageSites),
      this.rbac.hasGlobalPermission(userId, PermissionCode.DashboardGlobalRead),
    ]);
    if (sites || dashboards) return {};
    return {
      OR: [
        { users: { some: { id: userId } } },
        { responsibleId: userId },
        { delegations: { some: { delegataireId: userId } } },
      ],
    };
  }

  async findVisible(uuid: string, userId: string) {
    const site = await this.database.site.findFirst({
      where: { id: uuid, AND: [await this.visibleTo(userId)] },
      include: includeResponsible,
    });
    if (!site) throw new NotFoundException(`Site ${uuid} not found`);
    return site;
  }

  async findAll(query: FindSitesQueryDto = {}, userId?: string) {
    const contains = query.search
      ? { contains: query.search, mode: 'insensitive' as const }
      : undefined;
    const where: Prisma.SiteWhereInput = {
      AND: userId ? [await this.visibleTo(userId)] : [],
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
    return this.database.site.update({
      where: { id: uuid },
      data: dto,
      include: includeResponsible,
    });
  }

  // The responsible is the site's administrator (users, delegations, audit
  // of that site — see RbacService.administeredSites): an active person of
  // that company, responsible of no other site.
  private async assertEligibleResponsible(userId: string, siteId: string) {
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
    // A site is a company of the core: its responsible works for it.
    if (user.siteId !== siteId) {
      throw new BadRequestException(
        `${user.name} does not belong to this company and cannot be its responsible`,
      );
    }
    const other = user.managedSites.find((managed) => managed.id !== siteId);
    if (other) {
      throw new BadRequestException(
        `${user.name} is already the responsible of site "${other.name}"`,
      );
    }
  }
}
