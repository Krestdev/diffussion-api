import { ForbiddenException, Injectable } from '@nestjs/common';
import { ClsService } from 'nestjs-cls';
import { AccessProfile, Prisma } from '../../../generated/prisma/client';
import { AppClsStore } from '../../cls.store';
import { DatabaseService } from '../../database/database.service';
import { normalizePermissions, Permission } from '../permissions';

/** Resources that resolve to the company owning them (see AccessService.resolveCompanyId). */
export type CompanyEntity =
  | 'company'
  | 'dossier'
  | 'courrier'
  | 'instruction'
  | 'livrable'
  | 'analysisSheet'
  | 'analysisItem';

const effetCompanySelect = {
  dossier: { select: { companyId: true } },
  createdBy: { select: { companyId: true } },
} as const;

function effetCompany(effet: {
  dossier: { companyId: string } | null;
  createdBy: { companyId: string | null } | null;
}): string | null {
  return effet.dossier?.companyId ?? effet.createdBy?.companyId ?? null;
}

const taskCompanySelect = {
  dossier: { select: { companyId: true } },
  courrier: { select: effetCompanySelect },
  contract: { select: { project: { select: { companyId: true } } } },
} as const;

function taskCompany(task: {
  dossier: { companyId: string } | null;
  courrier: Parameters<typeof effetCompany>[0] | null;
  contract: { project: { companyId: string } | null } | null;
}): string | null {
  return (
    task.dossier?.companyId ??
    (task.courrier ? effetCompany(task.courrier) : null) ??
    task.contract?.project?.companyId ??
    null
  );
}

const sheetCompanySelect = {
  dossier: { select: { companyId: true } },
  courrier: { select: { createdBy: { select: { companyId: true } } } },
} as const;

function sheetCompany(sheet: {
  dossier: { companyId: string } | null;
  courrier: { createdBy: { companyId: string | null } | null };
}): string | null {
  return (
    sheet.dossier?.companyId ?? sheet.courrier.createdBy?.companyId ?? null
  );
}

/** Delegations in force right now (`endDate` is an inclusive day). */
export function activeDelegationsFilter(): Prisma.DelegationWhereInput {
  const now = new Date();
  const startOfToday = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
  );
  return { startDate: { lte: now }, endDate: { gte: startOfToday } };
}

/**
 * People's permissions in Diffusion, as EXPENZO computes them: the codes of the roles they hold in
 * their own company (roles belong to one company; archived roles give nothing), plus those of the
 * roles delegated to them there and in force, normalised (each action with the reads it implies).
 * A person acts only in their own company: data isolation stays in the services (companyId
 * filters); `scope` and `companyFilter` give them their company when they hold a permission.
 *
 * For the signed-in person the codes computed by CoreAuthGuard are reused (request context);
 * anyone else's are read from the tables.
 */
@Injectable()
export class AccessService {
  constructor(
    private readonly database: DatabaseService,
    private readonly cls: ClsService<AppClsStore>,
  ) {}

  /** The request's own person: their codes, company and profile, when `userId` is them. */
  private current(userId: string) {
    if (!this.cls.isActive() || this.cls.get('userId') !== userId) return null;
    const permissions = this.cls.get('permissions');
    if (!permissions) return null;
    return {
      permissions,
      companyId: this.cls.get('companyId') ?? null,
      platformAdmin: this.cls.get('platformAdmin') ?? false,
    };
  }

  /** The codes a person holds in their company (roles and delegations), normalised. */
  async permissionsOf(userId: string): Promise<Permission[]> {
    const current = this.current(userId);
    if (current) return [...current.permissions] as Permission[];
    const user = await this.database.user.findUnique({
      where: { id: userId },
      select: { companyId: true },
    });
    if (!user?.companyId) return [];
    return this.computePermissions(userId, user.companyId);
  }

  /** From the tables, for a person of `companyId`. */
  async computePermissions(
    userId: string,
    companyId: string,
  ): Promise<Permission[]> {
    const permissionsSelect = {
      role: {
        select: {
          rolePermissions: {
            select: { permission: { select: { code: true } } },
          },
        },
      },
    } as const;
    const inCompany = { companyId, archivedAt: null };
    const [grants, delegated] = await Promise.all([
      this.database.userRole.findMany({
        where: { userId, role: inCompany },
        select: permissionsSelect,
      }),
      this.database.delegation.findMany({
        where: {
          delegataireId: userId,
          companyId,
          role: inCompany,
          ...activeDelegationsFilter(),
        },
        select: permissionsSelect,
      }),
    ]);
    return normalizePermissions(
      [...grants, ...delegated].flatMap(({ role }) =>
        role.rolePermissions.map((rp) => rp.permission.code),
      ),
    );
  }

  async has(userId: string, permission: Permission): Promise<boolean> {
    const current = this.current(userId);
    if (current) return current.permissions.includes(permission);
    return (await this.permissionsOf(userId)).includes(permission);
  }

  async hasAny(userId: string, ...permissions: Permission[]): Promise<boolean> {
    const held = await this.permissionsOf(userId);
    return permissions.some((permission) => held.includes(permission));
  }

  /** The person's company (null: none, e.g. a platform account). */
  async companyOf(userId: string): Promise<string | null> {
    const current = this.current(userId);
    if (current) return current.companyId;
    const user = await this.database.user.findUnique({
      where: { id: userId },
      select: { companyId: true },
    });
    return user?.companyId ?? null;
  }

  /**
   * A Diffusion super-administrator (A·2 profile SUPER_ADMIN): the only one who changes what is
   * common to every company (natures, contract types, categories, the common analysis criteria,
   * the platform settings, the permission labels), with the permission that covers it.
   */
  async isPlatformAdmin(userId: string): Promise<boolean> {
    const current = this.current(userId);
    if (current) return current.platformAdmin;
    const user = await this.database.user.findUnique({
      where: { id: userId },
      select: { accessProfile: true },
    });
    return user?.accessProfile === AccessProfile.SUPER_ADMIN;
  }

  /** Holds `permission` and is a super-administrator: may change what every company shares. */
  async managesCommon(userId: string, permission: Permission) {
    return (
      (await this.isPlatformAdmin(userId)) &&
      (await this.has(userId, permission))
    );
  }

  /** Where the person may use `permission`: their company, or nowhere. */
  async scope(userId: string, permission: Permission): Promise<string[]> {
    if (!(await this.has(userId, permission))) return [];
    const companyId = await this.companyOf(userId);
    return companyId ? [companyId] : [];
  }

  /** Holds `permission`, and `companyId` is their company. */
  async hasAtCompany(
    userId: string,
    permission: Permission,
    companyId: string | null,
  ): Promise<boolean> {
    if (!companyId) return false;
    return (
      (await this.companyOf(userId)) === companyId &&
      (await this.has(userId, permission))
    );
  }

  /** Whether `companyId` is the person's own company. */
  async worksAtCompany(userId: string, companyId: string): Promise<boolean> {
    return (await this.companyOf(userId)) === companyId;
  }

  /**
   * Narrows a list to the person's company when they hold `permission` (`companyId in []` gives
   * no row otherwise). `toWhere` places that condition on the listed model.
   */
  async companyFilter<W>(
    userId: string,
    permission: Permission,
    toWhere: (companyId: { in: string[] }) => W,
  ): Promise<W> {
    return toWhere({ in: await this.scope(userId, permission) });
  }

  /**
   * Refuses unless the person holds `permission` and the object belongs to their company. An
   * object common to every company (`companyId` null) needs a super-administrator. `what` names
   * the object ("Le critère « Forme »").
   */
  async assertManages(
    userId: string,
    permission: Permission,
    companyId: string | null,
    what: string,
  ): Promise<void> {
    if (!(await this.has(userId, permission))) {
      throw new ForbiddenException({
        code: 'FORBIDDEN',
        message: `Missing permission: ${permission}`,
        params: { permission },
      });
    }
    if (companyId === null) {
      if (await this.isPlatformAdmin(userId)) return;
      throw new ForbiddenException(
        `Refusé : ${what} est commun à toutes les sociétés — seul un super-administrateur de Diffusion peut le gérer.`,
      );
    }
    if (!(await this.worksAtCompany(userId, companyId))) {
      throw new ForbiddenException(
        `Refusé : ${what} appartient à une autre société.`,
      );
    }
  }

  /**
   * The company owning a resource. `undefined` when the resource doesn't exist (the service
   * answers 404), `null` when it has no company yet (a sortant draft not attached to a dossier).
   */
  async resolveCompanyId(
    entity: CompanyEntity,
    id: string,
  ): Promise<string | null | undefined> {
    const db = this.database;
    switch (entity) {
      case 'company':
        return (
          await db.company.findUnique({ where: { id }, select: { id: true } })
        )?.id;
      case 'dossier':
        return (
          await db.dossier.findUnique({
            where: { id },
            select: { companyId: true },
          })
        )?.companyId;
      // An effet's company: its dossier's, else its registrant's.
      case 'courrier': {
        const courrier = await db.courrier.findUnique({
          where: { id },
          select: effetCompanySelect,
        });
        return courrier ? effetCompany(courrier) : undefined;
      }
      // A task's company: its dossier's, else its effet's, else its contract's project's.
      case 'instruction': {
        const instr = await db.instruction.findUnique({
          where: { id },
          select: taskCompanySelect,
        });
        return instr ? taskCompany(instr) : undefined;
      }
      case 'livrable': {
        const liv = await db.livrable.findUnique({
          where: { id },
          select: { instruction: { select: taskCompanySelect } },
        });
        return liv ? taskCompany(liv.instruction) : undefined;
      }
      // A fiche's dossier's company, or — without a dossier — the company of whoever
      // registered its courrier.
      case 'analysisSheet': {
        const sheet = await db.analysisSheet.findUnique({
          where: { id },
          select: sheetCompanySelect,
        });
        return sheet ? sheetCompany(sheet) : undefined;
      }
      case 'analysisItem': {
        const item = await db.analysisItem.findUnique({
          where: { id },
          select: { sheet: { select: sheetCompanySelect } },
        });
        return item ? sheetCompany(item.sheet) : undefined;
      }
    }
  }

  /**
   * Refuses (403) when the resource belongs to another company than the person's. A resource
   * that doesn't exist, or has no company yet, passes: the service answers 404 / applies its rule.
   */
  async assertSameCompany(
    userId: string,
    entity: CompanyEntity,
    id: string | null | undefined,
  ): Promise<void> {
    if (!id) return;
    const companyId = await this.resolveCompanyId(entity, id);
    if (!companyId) return;
    if (!(await this.worksAtCompany(userId, companyId))) {
      throw new ForbiddenException('This belongs to another company');
    }
  }
}
