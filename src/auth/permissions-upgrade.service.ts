import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { AppConfigService } from '../config/app-config.service';
import { AppAccessService } from '../core/app-access.service';
import { DatabaseService } from '../database/database.service';
import { permissionIds, syncPermissionCatalog } from './default-roles';
import {
  ADMIN_ROLE_CODE,
  ALL_PERMISSIONS,
  CATALOG_VERSION,
  compareVersions,
  normalizePermissions,
} from './permissions';

/**
 * Moves every company's roles to this catalogue version once (as EXPENZO's): at start-up, the
 * permission table first (roles point at its rows), then each company still on an older version
 * (Company.permissionsVersion), claimed in its transaction so two instances never apply it twice.
 * Every company's ADMIN role ends with every permission (CDC G1: future ones too).
 */
@Injectable()
export class PermissionsUpgradeService implements OnApplicationBootstrap {
  private readonly logger = new Logger(PermissionsUpgradeService.name);

  constructor(
    private readonly database: DatabaseService,
    private readonly access: AppAccessService,
    private readonly config: AppConfigService,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    if (this.config.get('NODE_ENV') === 'test') return;
    await this.upgradeAll().catch((error: unknown) =>
      this.logger.error(
        `permission upgrade failed: ${error instanceof Error ? error.message : String(error)}`,
      ),
    );
  }

  /** Upgrades every company on an older catalogue; returns the companies moved. */
  async upgradeAll(): Promise<string[]> {
    await this.database.$transaction((tx) => syncPermissionCatalog(tx));
    const companies = await this.database.company.findMany({
      where: { permissionsVersion: { not: CATALOG_VERSION } },
      select: { id: true, permissionsVersion: true },
    });
    const moved: string[] = [];
    for (const company of companies) {
      if (compareVersions(company.permissionsVersion, CATALOG_VERSION) > 0) {
        this.logger.warn(
          `company ${company.id} follows catalogue ${company.permissionsVersion}, newer than ${CATALOG_VERSION}: left as it is`,
        );
        continue;
      }
      if (await this.upgrade(company.id, company.permissionsVersion)) {
        moved.push(company.id);
      }
    }
    if (moved.length) {
      this.logger.log(
        `${moved.length} company(ies) moved to permission catalogue ${CATALOG_VERSION}`,
      );
    }
    await this.completeAdminRoles();
    return moved;
  }

  private upgrade(companyId: string, from: string): Promise<boolean> {
    return this.database.$transaction(async (tx) => {
      const claimed = await tx.company.updateMany({
        where: { id: companyId, permissionsVersion: from },
        data: { permissionsVersion: CATALOG_VERSION },
      });
      if (claimed.count === 0) return false;
      const roles = await tx.role.findMany({
        where: { companyId },
        select: {
          id: true,
          code: true,
          isSystem: true,
          rolePermissions: {
            select: { permission: { select: { code: true } } },
          },
        },
      });
      const ids = await permissionIds(tx, ALL_PERMISSIONS);
      for (const role of roles) {
        const codes =
          role.code === ADMIN_ROLE_CODE && role.isSystem
            ? [...ALL_PERMISSIONS]
            : normalizePermissions(
                role.rolePermissions.map((rp) => rp.permission.code),
                { from },
              );
        const wanted = codes.map((code) => ids.get(code)!).filter(Boolean);
        await tx.rolePermission.deleteMany({
          where: { roleId: role.id, permissionId: { notIn: wanted } },
        });
        await tx.rolePermission.createMany({
          data: wanted.map((permissionId) => ({
            roleId: role.id,
            permissionId,
          })),
          skipDuplicates: true,
        });
      }
      return true;
    });
  }

  /** Every company's ADMIN role gains the codes added to the catalogue. */
  private async completeAdminRoles(): Promise<void> {
    const admins = await this.database.role.findMany({
      where: { code: ADMIN_ROLE_CODE, isSystem: true },
      select: { id: true, _count: { select: { rolePermissions: true } } },
    });
    const incomplete = admins.filter(
      (role) => role._count.rolePermissions < ALL_PERMISSIONS.length,
    );
    if (incomplete.length === 0) return;
    const ids = await this.database.$transaction((tx) =>
      permissionIds(tx, ALL_PERMISSIONS),
    );
    for (const role of incomplete) {
      await this.database.rolePermission.createMany({
        data: [...ids.values()].map((permissionId) => ({
          roleId: role.id,
          permissionId,
        })),
        skipDuplicates: true,
      });
      const holders = await this.database.userRole.findMany({
        where: { roleId: role.id },
        select: { userId: true },
      });
      await this.access.refresh(holders.map((h) => h.userId));
    }
  }
}
