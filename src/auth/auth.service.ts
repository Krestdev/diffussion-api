import { Injectable } from '@nestjs/common';
import { AccessService } from './access/access.service';
import { DatabaseService } from '../database/database.service';
import { AuthUser, CoreRequestContext } from './types/auth-user.type';
import {
  ContractStatus,
  DossierStatus,
  ProjectStatus,
  CompanyStatus,
} from '../generated/prisma/enums';

@Injectable()
export class AuthService {
  constructor(
    private readonly database: DatabaseService,
    private readonly access: AccessService,
  ) {}

  // The current user's own profile, including the roles/companies the frontend
  // needs to render the sidebar and gate UI without a separate call into
  // the (permission-gated) administration/users endpoints, plus what the
  // core says: their company's apps (the app switcher)
  // and who acts as them ("sign in as").
  async me(user: AuthUser, core: CoreRequestContext) {
    const userUuid = user.sub;
    const record = await this.database.user.findUniqueOrThrow({
      where: { id: userUuid },
      include: {
        userRoles: {
          // The roles of their company (a role belongs to one company), in use.
          where: { role: { companyId: user.companyId, archivedAt: null } },
          include: {
            role: {
              include: {
                rolePermissions: { include: { permission: true } },
                company: { select: { id: true, name: true } },
              },
            },
          },
        },
        company: true,
      },
    });

    const { userRoles, ...rest } = record;
    const roles = [...new Set(userRoles.map((ur) => ur.role.name))];
    // Their codes in their company: roles and delegations in force, each action with the reads
    // it implies (the same set the guards check).
    const permissions = [...user.permissions].sort();

    return {
      // Their company (the core's, kept in Diffusion under the same id) is
      // in `company` / `companyId`.
      ...rest,
      // The interface language: the person's, else their company's (both kept by the core).
      language: core.account.language,
      companyLanguage: core.account.tenant.defaultLanguage,
      apps: core.account.apps.map((app) => ({
        id: app.id,
        name: app.name,
        url: app.url,
        icon: app.icon,
        access: app.access,
      })),
      impersonatedBy: user.impersonator,
      roles,
      // Each role held, with the company it belongs to (theirs).
      roleGrants: userRoles.map((ur) => ({
        role: { id: ur.role.id, name: ur.role.name, code: ur.role.code },
        company: ur.role.company,
      })),
      // Their permission codes in their company (what every check uses).
      permissions,
      // A Diffusion super-administrator: manages what every company shares.
      platformAdmin: user.platformAdmin,
      ...(await this.designations(userUuid)),
    };
  }

  // What the user is the designated responsible of — only what is still
  // live (a closed or archived dossier, an archived contract or project, an
  // inactive company no longer counts).
  private async designations(userId: string) {
    const [companies, projects, contracts, dossiers] = await Promise.all([
      this.database.company.findMany({
        where: { responsibleId: userId, status: CompanyStatus.ACTIVE },
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
        companies.length +
          projects.length +
          contracts.length +
          dossiers.length >
        0,
      responsibleOf: { companies, projects, contracts, dossiers },
    };
  }
}
