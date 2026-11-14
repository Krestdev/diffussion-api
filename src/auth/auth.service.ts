import { Injectable } from '@nestjs/common';
import { RbacService } from './rbac/rbac.service';
import { DatabaseService } from '../database/database.service';
import { AuthUser, CoreRequestContext } from './types/auth-user.type';
import {
  ContractStatus,
  DossierStatus,
  ProjectStatus,
  SiteStatus,
} from 'generated/prisma/enums';

@Injectable()
export class AuthService {
  constructor(
    private readonly database: DatabaseService,
    private readonly rbac: RbacService,
  ) {}

  // The current user's own profile, including the roles/sites the frontend
  // needs to render the sidebar and gate UI without a separate call into
  // the (permission-gated) administration/users endpoints, plus what the
  // core says: their company (= their site), its apps (the app switcher)
  // and who acts as them ("sign in as").
  async me(user: AuthUser, core: CoreRequestContext) {
    const userUuid = user.sub;
    const record = await this.database.user.findUniqueOrThrow({
      where: { id: userUuid },
      include: {
        userRoles: {
          include: {
            role: {
              include: { rolePermissions: { include: { permission: true } } },
            },
            site: { select: { id: true, name: true } },
          },
        },
        site: true,
      },
    });

    const { userRoles, ...rest } = record;
    // One UserRole row per site: a role held at several sites is listed once.
    const roles = [...new Set(userRoles.map((ur) => ur.role.name))];
    // Held somewhere, by a role or by being a site's responsible.
    const permissions = await this.rbac.getPermissionCodes(userUuid);

    return {
      ...rest,
      companyId: core.account.tenant.id,
      company: record.site
        ? { id: record.site.id, name: record.site.name }
        : { id: core.account.tenant.id, name: core.account.tenant.name },
      apps: core.account.apps.map((app) => ({
        id: app.id,
        name: app.name,
        url: app.url,
        icon: app.icon,
        access: app.access,
      })),
      impersonatedBy: user.impersonator,
      roles,
      // Where each role is held: `site` null means global (every site).
      roleGrants: userRoles.map((ur) => ({
        role: { id: ur.role.id, name: ur.role.name },
        site: ur.site,
      })),
      // Held somewhere — kept for the existing menu checks.
      permissions,
      // What applies at each site (global + bySite[siteId]), delegations
      // included: what an action on a given resource is checked against.
      sitePermissions: await this.rbac.permissionsBySite(userUuid),
      ...(await this.designations(userUuid)),
    };
  }

  // What the user is the designated responsible of — only what is still
  // live (a closed or archived dossier, an archived contract or project, an
  // inactive site no longer counts).
  private async designations(userId: string) {
    const [sites, projects, contracts, dossiers] = await Promise.all([
      this.database.site.findMany({
        where: { responsibleId: userId, status: SiteStatus.ACTIVE },
        select: { id: true, name: true },
        orderBy: { name: 'asc' },
      }),
      this.database.project.findMany({
        where: {
          responsibleId: userId,
          status: { not: ProjectStatus.ARCHIVED },
        },
        select: { id: true, name: true, reference: true },
        orderBy: { name: 'asc' },
      }),
      this.database.contract.findMany({
        where: { responsibleId: userId, status: ContractStatus.ACTIVE },
        select: { id: true, number: true, reference: true, title: true },
        orderBy: { number: 'asc' },
      }),
      this.database.dossier.findMany({
        where: {
          responsibleId: userId,
          status: { notIn: [DossierStatus.CLOSED, DossierStatus.ARCHIVED] },
        },
        select: { id: true, number: true, title: true },
        orderBy: { number: 'asc' },
      }),
    ]);
    return {
      isDesignatedResponsible:
        sites.length + projects.length + contracts.length + dossiers.length > 0,
      responsibleOf: { sites, projects, contracts, dossiers },
    };
  }
}
