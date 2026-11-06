import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '../../../generated/prisma/client';
import {
  PermissionCode,
  PLATFORM_PERMISSIONS,
} from '../../auth/rbac/rbac.constants';
import {
  assertAdministers,
  assertInScope,
  RbacService,
  SiteScopeList,
} from '../../auth/rbac/rbac.service';
import { ActivityService } from '../../activity/activity.service';
import { DEFAULT_TAKE } from '../../common/dto/pagination.query.dto';
import { createWithUniqueReference } from '../../common/utils/generate-reference';
import { DatabaseService } from '../../database/database.service';
import { ArchiveRoleDto } from './dto/archive-role.dto';
import { CreateRoleDto } from './dto/create-role.dto';
import { FindRolesQueryDto } from './dto/find-roles.query.dto';
import { UpdateRoleDto } from './dto/update-role.dto';

const roleInclude = {
  rolePermissions: { include: { permission: true } },
  site: { select: { id: true, name: true } },
  archivedBy: { select: { id: true, name: true } },
  // One UserRole row per site the role is held at: count distinct users.
  userRoles: { select: { userId: true }, distinct: ['userId'] },
} satisfies Prisma.RoleInclude;

function toView(role: Prisma.RoleGetPayload<{ include: typeof roleInclude }>) {
  const { rolePermissions, userRoles, ...rest } = role;
  return {
    ...rest,
    permissions: rolePermissions.map((rp) => rp.permission),
    usersCount: userRoles.length,
  };
}

/**
 * Global roles (no site) are made by a platform administrator and usable on
 * every site; a site's responsible makes and manages the roles of their own
 * site. Everyone sees the global roles plus those of their own site.
 */
@Injectable()
export class RoleService {
  constructor(
    private readonly database: DatabaseService,
    private readonly rbac: RbacService,
    private readonly activity: ActivityService,
  ) {}

  // The audit journal (AU·1): every change to a role, with its permissions
  // before / after when they change.
  private journal(
    action: string,
    roleId: string,
    extra: {
      changes?: Record<string, [unknown, unknown]>;
      metadata?: Record<string, unknown>;
    } = {},
  ) {
    return this.activity.tryRecord({
      action,
      entityType: 'role',
      entityId: roleId,
      ...extra,
    });
  }

  private async permissionCodes(roleId: string) {
    const rows = await this.database.rolePermission.findMany({
      where: { roleId },
      select: { permission: { select: { code: true } } },
    });
    return rows.map((row) => row.permission.code).sort();
  }

  async create(dto: CreateRoleDto, actingUserId: string) {
    const scope = await this.adminScope(actingUserId);
    const { permissionIds, siteId: requestedSiteId, ...data } = dto;
    const siteId = this.siteForNewRole(scope, requestedSiteId);
    assertInScope(scope, siteId);
    // Checked up front: createWithUniqueReference retries on *any* unique
    // violation, so a duplicate name would otherwise burn every retry on
    // fresh codes and surface as a 500.
    await this.assertNameAvailable(dto.name, siteId);
    await this.assertPermissionsAllowed(permissionIds, siteId);
    const role = await createWithUniqueReference('RO', (code) =>
      this.database.role.create({
        data: {
          ...data,
          code,
          siteId,
          rolePermissions: permissionIds
            ? {
                create: permissionIds.map((permissionId) => ({
                  permissionId,
                })),
              }
            : undefined,
        },
        include: roleInclude,
      }),
    );
    const view = toView(role);
    await this.journal('role.created', role.id, {
      metadata: {
        name: role.name,
        siteId,
        permissions: view.permissions.map((p) => p.code).sort(),
      },
    });
    return view;
  }

  async findAll(query: FindRolesQueryDto, actingUserId: string) {
    const skip = query.skip ?? 0;
    const take = query.take ?? DEFAULT_TAKE;
    const where: Prisma.RoleWhereInput = {
      AND: [
        await this.visibleTo(actingUserId),
        query.siteId ? { siteId: query.siteId } : {},
        { archivedAt: query.archived ? { not: null } : null },
        query.search
          ? {
              OR: [
                { name: { contains: query.search, mode: 'insensitive' } },
                { code: { contains: query.search, mode: 'insensitive' } },
              ],
            }
          : {},
      ],
    };
    const [roles, total] = await this.database.$transaction([
      this.database.role.findMany({
        where,
        orderBy: { name: 'asc' },
        // Full view, not a slimmed-down list row: the admin table shows the
        // permission count and creation date, and its edit/view dialogs
        // open straight from the row's `permissions`.
        include: roleInclude,
        skip,
        take,
      }),
      this.database.role.count({ where }),
    ]);
    return { data: roles.map(toView), total, skip, take };
  }

  async findOne(id: string, actingUserId: string) {
    const role = await this.database.role.findFirst({
      where: { id, AND: [await this.visibleTo(actingUserId)] },
      include: roleInclude,
    });
    if (!role) {
      throw new NotFoundException(`Role ${id} not found`);
    }
    return toView(role);
  }

  async update(id: string, dto: UpdateRoleDto, actingUserId: string) {
    const scope = await this.adminScope(actingUserId);
    const existing = await this.ensureExists(id);
    assertInScope(scope, existing.siteId);
    if (existing.archivedAt) {
      throw new BadRequestException(
        'This role is archived — restore it before changing it',
      );
    }
    if (dto.name !== undefined && dto.name !== existing.name) {
      await this.assertNameAvailable(dto.name, existing.siteId);
    }
    await this.assertPermissionsAllowed(dto.permissionIds, existing.siteId);
    const { permissionIds, ...data } = dto;
    const before = await this.permissionCodes(id);

    // Guarded: dropping admin permissions from the last admin role would
    // lock everyone out of administration.
    const role = await this.rbac.withAdminCoverage((tx) =>
      tx.role.update({
        where: { id },
        data: {
          ...data,
          // Replace-set semantics: the caller always sends the full desired
          // permission list (matches the "Modifier le rôle" checkbox grid).
          rolePermissions:
            permissionIds !== undefined
              ? {
                  deleteMany: {},
                  create: permissionIds.map((permissionId) => ({
                    permissionId,
                  })),
                }
              : undefined,
        },
        include: roleInclude,
      }),
    );
    const view = toView(role);
    const after = view.permissions.map((p) => p.code).sort();
    const changes: Record<string, [unknown, unknown]> = {};
    for (const key of ['name', 'description'] as const) {
      if (dto[key] !== undefined && dto[key] !== existing[key]) {
        changes[key] = [existing[key], dto[key]];
      }
    }
    if (before.join() !== after.join()) {
      changes.permissions = [before, after];
    }
    await this.journal('role.updated', id, {
      changes,
      metadata: {
        added: after.filter((code) => !before.includes(code)),
        removed: before.filter((code) => !after.includes(code)),
      },
    });
    return view;
  }

  /**
   * A role is never deleted: archived (A·9), it is held by nobody any more
   * and offered nowhere, and can be restored. Its holders lose it, or get
   * `reassignToRoleId` instead (a role in use, global or of the same site);
   * so do the delegations still running and the pending invitations.
   */
  async archive(id: string, dto: ArchiveRoleDto, actingUserId: string) {
    const scope = await this.adminScope(actingUserId);
    const role = await this.ensureExists(id);
    assertInScope(scope, role.siteId);
    if (role.archivedAt) {
      throw new BadRequestException('This role is already archived');
    }
    const replacementId = dto.reassignToRoleId;
    if (replacementId) {
      if (replacementId === id) {
        throw new BadRequestException('A role cannot replace itself');
      }
      const replacement = await this.ensureExists(replacementId);
      if (replacement.archivedAt) {
        throw new BadRequestException('The replacement role is archived');
      }
      if (replacement.siteId !== null && replacement.siteId !== role.siteId) {
        throw new BadRequestException(
          'The replacement role belongs to another site',
        );
      }
    }

    const now = new Date();
    const holders = await this.rbac.withAdminCoverage(async (tx) => {
      const grants = await tx.userRole.findMany({
        where: { roleId: id },
        select: { userId: true, siteId: true },
      });
      if (replacementId && grants.length) {
        await tx.userRole.createMany({
          data: grants.map((grant) => ({ ...grant, roleId: replacementId })),
          skipDuplicates: true,
        });
      }
      await tx.userRole.deleteMany({ where: { roleId: id } });
      // Delegations still running: handed the replacement, or ended now.
      const running = { roleId: id, endDate: { gte: now } };
      if (replacementId) {
        await tx.delegation.updateMany({
          where: running,
          data: { roleId: replacementId },
        });
      } else {
        await tx.delegation.updateMany({
          where: { ...running, startDate: { gt: now } },
          data: { startDate: now, endDate: now },
        });
        await tx.delegation.updateMany({
          where: running,
          data: { endDate: now },
        });
      }
      await tx.invitation.updateMany({
        where: { roleId: id, acceptedAt: null, revokedAt: null },
        data: { roleId: replacementId ?? null },
      });
      await tx.role.update({
        where: { id },
        data: { archivedAt: now, archivedById: actingUserId },
      });
      return new Set(grants.map((grant) => grant.userId)).size;
    });
    await this.journal('role.archived', id, {
      metadata: { holders, reassignedToRoleId: replacementId ?? null },
    });
    return {
      ...(await this.findOne(id, actingUserId)),
      holders,
      reassignedToRoleId: replacementId ?? null,
    };
  }

  // Back in use, held by nobody: its former holders are not given it back.
  async restore(id: string, actingUserId: string) {
    const scope = await this.adminScope(actingUserId);
    const role = await this.ensureExists(id);
    assertInScope(scope, role.siteId);
    if (!role.archivedAt) {
      throw new BadRequestException('This role is not archived');
    }
    await this.database.role.update({
      where: { id },
      data: { archivedAt: null, archivedById: null },
    });
    await this.journal('role.restored', id);
    return this.findOne(id, actingUserId);
  }

  // 'ALL' for a platform administrator, else the site they are the
  // responsible of; anyone else is refused.
  private async adminScope(actingUserId: string): Promise<SiteScopeList> {
    const scope = await this.rbac.managedSites(
      actingUserId,
      PermissionCode.AdminManageRoles,
    );
    assertAdministers(scope);
    return scope;
  }

  // A site's responsible makes roles for their site without naming it; a
  // platform administrator makes global roles unless they name a site.
  private siteForNewRole(
    scope: SiteScopeList,
    requested: string | undefined,
  ): string | null {
    if (requested !== undefined) return requested;
    if (scope === 'ALL') return null;
    if (scope.length === 1) return scope[0];
    throw new BadRequestException('siteId is required');
  }

  // Global roles, plus the roles of the caller's own site — everything for a
  // platform administrator.
  private async visibleTo(
    actingUserId: string,
  ): Promise<Prisma.RoleWhereInput> {
    if (
      await this.rbac.hasGlobalPermission(
        actingUserId,
        PermissionCode.AdminManageRoles,
      )
    ) {
      return {};
    }
    const user = await this.database.user.findUnique({
      where: { id: actingUserId },
      select: { siteId: true },
    });
    return {
      OR: [
        { siteId: null },
        ...(user?.siteId ? [{ siteId: user.siteId }] : []),
      ],
    };
  }

  private async ensureExists(id: string) {
    const role = await this.database.role.findUnique({ where: { id } });
    if (!role) {
      throw new NotFoundException(`Role ${id} not found`);
    }
    return role;
  }

  private async assertNameAvailable(name: string, siteId: string | null) {
    const taken = await this.database.role.findFirst({
      where: { name, siteId },
      select: { id: true },
    });
    if (taken) {
      throw new ConflictException(`A role named "${name}" already exists`);
    }
  }

  // Organisation-wide permissions (PLATFORM_PERMISSIONS) only work through a
  // global grant, which a site role never is — refused rather than granted
  // for nothing.
  private async assertPermissionsAllowed(
    permissionIds: string[] | undefined,
    siteId: string | null,
  ) {
    if (!permissionIds?.length) return;
    const found = await this.database.permission.findMany({
      where: { id: { in: permissionIds } },
      select: { id: true, code: true },
    });
    const missing = permissionIds.filter(
      (id) => !found.some((p) => p.id === id),
    );
    if (missing.length) {
      throw new BadRequestException(
        `Unknown permission ids: ${missing.join(', ')}`,
      );
    }
    if (siteId) {
      const platformOnly = found.filter((p) =>
        PLATFORM_PERMISSIONS.has(p.code as PermissionCode),
      );
      if (platformOnly.length) {
        throw new BadRequestException(
          `A site role can't carry platform permissions: ${platformOnly.map((p) => p.code).join(', ')}`,
        );
      }
    }
  }
}
