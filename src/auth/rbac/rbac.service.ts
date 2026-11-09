import {
  ConflictException,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Prisma, UserStatus } from '../../../generated/prisma/client';
import { DatabaseService } from '../../database/database.service';
import {
  addIncludedReads,
  PermissionCode,
  permissionsGranting,
  SITE_RESPONSIBLE_PERMISSIONS,
} from './rbac.constants';
import { SiteEntity } from './site-scope.decorator';

// Permissions that must always be held by at least one active user,
// otherwise nobody could ever manage users/roles again (lockout).
const LOCKOUT_CRITICAL_PERMISSIONS = [
  PermissionCode.AdminManageUsers,
  PermissionCode.AdminManageRoles,
];

/**
 * Where an administrator may act: 'ALL' for a platform user (global grant),
 * otherwise the sites they hold the permission at — their own site.
 */
export type SiteScopeList = 'ALL' | string[];

export function isInScope(scope: SiteScopeList, siteId: string | null) {
  return scope === 'ALL' || (siteId !== null && scope.includes(siteId));
}

/** 403 when the user administers nothing at all. */
export function assertAdministers(scope: SiteScopeList) {
  if (scope !== 'ALL' && scope.length === 0) {
    throw new ForbiddenException('Reserved to administrators');
  }
}

/** 403 unless `siteId` is within the administrator's scope. */
export function assertInScope(scope: SiteScopeList, siteId: string | null) {
  if (!isInScope(scope, siteId)) {
    throw new ForbiddenException('This belongs to another site');
  }
}

const effetSiteSelect = {
  dossier: { select: { siteId: true } },
  createdBy: { select: { siteId: true } },
} as const;

function effetSite(effet: {
  dossier: { siteId: string } | null;
  createdBy: { siteId: string | null } | null;
}): string | null {
  return effet.dossier?.siteId ?? effet.createdBy?.siteId ?? null;
}

const taskSiteSelect = {
  dossier: { select: { siteId: true } },
  courrier: { select: effetSiteSelect },
  contract: { select: { project: { select: { siteId: true } } } },
} as const;

function taskSite(task: {
  dossier: { siteId: string } | null;
  courrier: Parameters<typeof effetSite>[0] | null;
  contract: { project: { siteId: string } | null } | null;
}): string | null {
  return (
    task.dossier?.siteId ??
    (task.courrier ? effetSite(task.courrier) : null) ??
    task.contract?.project?.siteId ??
    null
  );
}

@Injectable()
export class RbacService {
  constructor(private readonly database: DatabaseService) {}

  /**
   * Delegations in force right now for this user: each gives them one role
   * at one site (see Delegation in schema.prisma). `endDate` is an inclusive
   * day, so a delegation ending today is still active.
   */
  private activeDelegationsFilter(): Prisma.DelegationWhereInput {
    const now = new Date();
    const startOfToday = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
    );
    return { startDate: { lte: now }, endDate: { gte: startOfToday } };
  }

  /**
   * Walks User -> UserRole -> Role -> RolePermission -> Permission (plus
   * active delegations) and returns the deduped permission codes.
   * - Without `siteId`: everything the user holds, at any site — what the
   *   PermissionGuard checks ("allowed somewhere").
   * - With `siteId`: only what applies there — global grants, grants at that
   *   site, and delegations at that site.
   * Either way, what being a site's responsible gives.
   */
  async getPermissionCodes(
    userUuid: string,
    siteId?: string,
  ): Promise<string[]> {
    const permissionsSelect = {
      role: {
        select: {
          rolePermissions: {
            select: { permission: { select: { code: true } } },
          },
        },
      },
    } as const;
    const [grants, delegated, responsibleOf] = await Promise.all([
      this.database.userRole.findMany({
        where: {
          userId: userUuid,
          ...(siteId ? { OR: [{ siteId }, { siteId: null }] } : {}),
        },
        select: permissionsSelect,
      }),
      this.database.delegation.findMany({
        where: {
          delegataireId: userUuid,
          siteId,
          ...this.activeDelegationsFilter(),
        },
        select: permissionsSelect,
      }),
      this.database.site.count({
        where: { responsibleId: userUuid, id: siteId },
      }),
    ]);

    const codes = new Set<string>(
      responsibleOf > 0 ? SITE_RESPONSIBLE_PERMISSIONS : [],
    );
    for (const { role } of [...grants, ...delegated]) {
      for (const rolePermission of role.rolePermissions) {
        codes.add(rolePermission.permission.code);
      }
    }
    addIncludedReads(codes);
    return [...codes];
  }

  async hasPermission(
    userUuid: string,
    permission: PermissionCode,
  ): Promise<boolean> {
    const codes = await this.getPermissionCodes(userUuid);
    return codes.includes(permission);
  }

  /**
   * The user's permissions as the frontend needs them to show or hide
   * actions per site: `global` applies everywhere, `bySite[siteId]` only
   * there (site grants and active delegations). At a site the user holds
   * `global` plus `bySite[siteId]`.
   */
  async permissionsBySite(
    userUuid: string,
  ): Promise<{ global: string[]; bySite: Record<string, string[]> }> {
    const permissionsSelect = {
      siteId: true,
      role: {
        select: {
          rolePermissions: {
            select: { permission: { select: { code: true } } },
          },
        },
      },
    } as const;
    const [grants, delegated, responsibleOf] = await Promise.all([
      this.database.userRole.findMany({
        where: { userId: userUuid },
        select: permissionsSelect,
      }),
      this.database.delegation.findMany({
        where: { delegataireId: userUuid, ...this.activeDelegationsFilter() },
        select: permissionsSelect,
      }),
      this.database.site.findMany({
        where: { responsibleId: userUuid },
        select: { id: true },
      }),
    ]);

    const global = new Set<string>();
    const bySite = new Map<string, Set<string>>(
      responsibleOf.map((site) => [
        site.id,
        new Set<string>(SITE_RESPONSIBLE_PERMISSIONS),
      ]),
    );
    for (const { siteId, role } of [...grants, ...delegated]) {
      const codes = role.rolePermissions.map((rp) => rp.permission.code);
      const target = siteId
        ? (bySite.get(siteId) ?? bySite.set(siteId, new Set()).get(siteId)!)
        : global;
      codes.forEach((code) => target.add(code));
    }
    addIncludedReads(global);
    bySite.forEach(addIncludedReads);
    return {
      global: [...global],
      bySite: Object.fromEntries(
        [...bySite].map(([siteId, codes]) => [
          siteId,
          [...codes].filter((code) => !global.has(code)),
        ]),
      ),
    };
  }

  /**
   * The sites this user administers: 'ALL' for a platform administrator
   * (global grant of `permission`), otherwise the sites they are the
   * responsible of — a site's responsible is its administrator. Empty for
   * everyone else.
   */
  async administeredSites(
    userUuid: string,
    permission: PermissionCode,
  ): Promise<SiteScopeList> {
    if (await this.hasGlobalPermission(userUuid, permission)) return 'ALL';
    const sites = await this.database.site.findMany({
      where: { responsibleId: userUuid },
      select: { id: true },
    });
    return sites.map((site) => site.id);
  }

  /**
   * Like administeredSites, plus the sites where the user holds
   * `permission` through a site role or a delegation — for the permissions
   * a site role may carry to manage that site's own data
   * (ADMIN_MANAGE_REFERENTIALS, ADMIN_MANAGE_ROLES). Never a global object:
   * those need 'ALL'.
   */
  async managedSites(
    userUuid: string,
    permission: PermissionCode,
  ): Promise<SiteScopeList> {
    const administered = await this.administeredSites(userUuid, permission);
    if (administered === 'ALL') return 'ALL';
    const held = await this.sitesWithPermission(userUuid, permission);
    if (held === 'ALL') return 'ALL';
    return [...new Set([...administered, ...held])];
  }

  /**
   * managedSites, with a refusal that says why: the permission is held
   * nowhere, the object is common to every site (platform administrators
   * only), or it belongs to a site the caller doesn't manage — naming the
   * sites they do manage. `what` names the object ("Le critère « Forme »").
   */
  async assertManagesSite(
    userUuid: string,
    permission: PermissionCode,
    siteId: string | null,
    what: string,
  ): Promise<SiteScopeList> {
    const scope = await this.managedSites(userUuid, permission);
    await this.explainOutOfScope(scope, siteId, what, permission);
    return scope;
  }

  /** The refusal of assertManagesSite, for a scope already computed. */
  async explainOutOfScope(
    scope: SiteScopeList,
    siteId: string | null,
    what: string,
    permission: PermissionCode,
  ): Promise<void> {
    if (isInScope(scope, siteId)) return;
    if (scope !== 'ALL' && scope.length === 0) {
      throw new ForbiddenException(
        `Refusé : vous n'avez la permission ${permission} sur aucun site et n'êtes responsable d'aucun site.`,
      );
    }
    const managed = await this.database.site.findMany({
      where: { id: { in: scope === 'ALL' ? [] : scope } },
      select: { name: true },
      orderBy: { name: 'asc' },
    });
    const mine = managed.map((site) => `« ${site.name} »`).join(', ');
    if (siteId === null) {
      throw new ForbiddenException(
        `Refusé : ${what} est commun à tous les sites — seul un administrateur plateforme (${permission} tenue globalement) peut le gérer. Vous gérez : ${mine}.`,
      );
    }
    const site = await this.database.site.findUnique({
      where: { id: siteId },
      select: { name: true },
    });
    throw new ForbiddenException(
      `Refusé : ${what} appartient au site « ${site?.name ?? siteId} » — vous ne gérez que ${mine}.`,
    );
  }

  /** Held through a global grant — what platform-wide administration needs. */
  async hasGlobalPermission(
    userUuid: string,
    permission: PermissionCode,
  ): Promise<boolean> {
    const grant = await this.database.userRole.findFirst({
      where: {
        userId: userUuid,
        siteId: null,
        role: {
          rolePermissions: {
            some: {
              permission: { code: { in: permissionsGranting(permission) } },
            },
          },
        },
      },
      select: { id: true },
    });
    return grant !== null;
  }

  async hasPermissionAtSite(
    userUuid: string,
    permission: PermissionCode,
    siteId: string,
  ): Promise<boolean> {
    const codes = await this.getPermissionCodes(userUuid, siteId);
    return codes.includes(permission);
  }

  /**
   * Where the user holds `permission`: 'ALL' through a global grant,
   * otherwise the sites of their site grants and active delegations, and
   * those they are the responsible of — meant for filtering lists by site.
   */
  async sitesWithPermission(
    userUuid: string,
    permission: PermissionCode,
  ): Promise<'ALL' | string[]> {
    const grantsPermission = {
      role: {
        rolePermissions: {
          some: {
            permission: { code: { in: permissionsGranting(permission) } },
          },
        },
      },
    };
    const [grants, delegated, responsibleOf] = await Promise.all([
      this.database.userRole.findMany({
        where: { userId: userUuid, ...grantsPermission },
        select: { siteId: true },
      }),
      this.database.delegation.findMany({
        where: {
          delegataireId: userUuid,
          ...grantsPermission,
          ...this.activeDelegationsFilter(),
        },
        select: { siteId: true },
      }),
      SITE_RESPONSIBLE_PERMISSIONS.includes(permission)
        ? this.database.site.findMany({
            where: { responsibleId: userUuid },
            select: { id: true },
          })
        : Promise.resolve<{ id: string }[]>([]),
    ]);
    if (grants.some((grant) => grant.siteId === null)) return 'ALL';
    return [
      ...new Set([
        ...grants.map((grant) => grant.siteId!),
        ...delegated.map((d) => d.siteId),
        ...responsibleOf.map((site) => site.id),
      ]),
    ];
  }

  /** Whether `siteId` is the user's own site, or one where they hold `permission`. */
  async worksAtSite(
    userUuid: string,
    permission: PermissionCode,
    siteId: string,
  ): Promise<boolean> {
    const sites = await this.sitesWithPermission(userUuid, permission);
    if (sites === 'ALL' || sites.includes(siteId)) return true;
    const user = await this.database.user.findUnique({
      where: { id: userUuid },
      select: { siteId: true },
    });
    return user?.siteId === siteId;
  }

  /**
   * Narrows a list to the sites where the user holds `permission`: `{}`
   * with a global grant, otherwise `siteId in (...)` — empty means no row.
   * `toWhere` places that condition on the listed model.
   */
  async siteFilter<W>(
    userUuid: string,
    permission: PermissionCode,
    toWhere: (siteId: { in: string[] }) => W,
  ): Promise<W | object> {
    const sites = await this.sitesWithPermission(userUuid, permission);
    return sites === 'ALL' ? {} : toWhere({ in: sites });
  }

  /**
   * The site owning a resource, for SiteScope checks. `undefined` when the
   * resource doesn't exist (the service answers 404), `null` when it has no
   * site yet (a sortant draft not attached to a dossier).
   */
  async resolveSiteId(
    entity: SiteEntity,
    id: string,
  ): Promise<string | null | undefined> {
    const db = this.database;
    switch (entity) {
      case 'site':
        return (
          await db.site.findUnique({ where: { id }, select: { id: true } })
        )?.id;
      case 'dossier':
        return (
          await db.dossier.findUnique({
            where: { id },
            select: { siteId: true },
          })
        )?.siteId;
      // An effet's site: its dossier's, else its registrant's — never "no
      // site", which would let any site's permission through.
      case 'courrier': {
        const courrier = await db.courrier.findUnique({
          where: { id },
          select: effetSiteSelect,
        });
        return courrier ? effetSite(courrier) : undefined;
      }
      // A task's site: its dossier's, else its effet's, else its contract's
      // project's.
      case 'instruction': {
        const instr = await db.instruction.findUnique({
          where: { id },
          select: taskSiteSelect,
        });
        return instr ? taskSite(instr) : undefined;
      }
      case 'livrable': {
        const liv = await db.livrable.findUnique({
          where: { id },
          select: { instruction: { select: taskSiteSelect } },
        });
        return liv ? taskSite(liv.instruction) : undefined;
      }
      // A fiche's dossier's site, or — without a dossier — the site of
      // whoever registered its courrier.
      case 'analysisSheet': {
        const sheet = await db.analysisSheet.findUnique({
          where: { id },
          select: sheetSiteSelect,
        });
        return sheet ? sheetSite(sheet) : undefined;
      }
      case 'analysisItem': {
        const item = await db.analysisItem.findUnique({
          where: { id },
          select: { sheet: { select: sheetSiteSelect } },
        });
        return item ? sheetSite(item.sheet) : undefined;
      }
    }
  }

  /**
   * Runs an administration change (user roles/status/deletion, role
   * permissions) and commits it only if every lockout-critical permission
   * is still held by at least one active user afterwards. Serializable so
   * two concurrent changes can't each remove "the other" last admin.
   */
  async withAdminCoverage<T>(
    change: (tx: Prisma.TransactionClient) => Promise<T>,
  ): Promise<T> {
    try {
      return await this.database.$transaction(
        async (tx) => {
          const result = await change(tx);
          await this.assertAdminCoverage(tx);
          return result;
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      );
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2034'
      ) {
        throw new ConflictException(
          'Another administration change happened at the same time, please retry',
        );
      }
      throw error;
    }
  }

  private async assertAdminCoverage(tx: Prisma.TransactionClient) {
    for (const code of LOCKOUT_CRITICAL_PERMISSIONS) {
      const holders = await tx.user.count({
        where: {
          status: UserStatus.ACTIVE,
          // Global grants only: the user/role administration is
          // organisation-wide, so a site grant doesn't keep it reachable.
          userRoles: {
            some: {
              siteId: null,
              role: { rolePermissions: { some: { permission: { code } } } },
            },
          },
        },
      });
      if (holders === 0) {
        throw new ConflictException(
          `This change would leave no active user holding ${code}`,
        );
      }
    }
  }
}

const sheetSiteSelect = {
  dossier: { select: { siteId: true } },
  courrier: { select: { createdBy: { select: { siteId: true } } } },
} as const;

function sheetSite(sheet: {
  dossier: { siteId: string } | null;
  courrier: { createdBy: { siteId: string | null } | null };
}): string | null {
  return sheet.dossier?.siteId ?? sheet.courrier.createdBy?.siteId ?? null;
}
