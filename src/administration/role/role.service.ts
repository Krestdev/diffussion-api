import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpException,
  HttpStatus,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ClsService } from 'nestjs-cls';
import { Prisma, UserStatus } from '../../generated/prisma/client';
import { ActivityService } from '../../activity/activity.service';
import { activeDelegationsFilter } from '../../auth/access/access.service';
import { permissionIds } from '../../auth/default-roles';
import {
  PERMISSION_GROUP_LABELS,
  PERMISSION_LABELS,
} from '../../auth/permission-labels';
import {
  ADMIN_ROLE_CODE,
  ALL_PERMISSIONS,
  CATALOG_VERSION,
  defaultPermissionsOf,
  IMPLIES,
  isPermission,
  normalizePermissions,
  PERMISSION_CATALOG,
} from '../../auth/permissions';
import { AppClsStore } from '../../cls.store';
import { DEFAULT_TAKE } from '../../common/dto/pagination.query.dto';
import { generateReference } from '../../common/utils/generate-reference';
import { AppAccessService } from '../../core/app-access.service';
import { DatabaseService } from '../../database/database.service';

type Labels = Readonly<Record<'en' | 'fr' | 'it', string>>;

/** The permissions roles can hold, grouped by kind of record, with labels. */
export interface PermissionCatalogView {
  version: string;
  groups: {
    key: string;
    labels: Labels;
    permissions: {
      code: string;
      /** The code without its group, e.g. "read.all" in effect.read.all. */
      action: string;
      description: string;
      labels: Labels;
    }[];
  }[];
  /** The reads each action brings (one way). */
  implies: Record<string, readonly string[]>;
}

const ROLE_INCLUDE = {
  rolePermissions: { select: { permission: { select: { code: true } } } },
  company: { select: { id: true, name: true } },
  archivedBy: { select: { id: true, name: true } },
  // People deleted in the core (C9) are no longer counted among the holders.
  _count: { select: { userRoles: { where: { user: { deletedAt: null } } } } },
} satisfies Prisma.RoleInclude;

type RoleRow = Prisma.RoleGetPayload<{ include: typeof ROLE_INCLUDE }>;

/** A role as the core's console reads it (EXPENZO's RoleView). */
export interface RoleView {
  id: string;
  code: string;
  name: string;
  description: string | null;
  isSystem: boolean;
  /** For default roles: whether its permissions differ from the default ones. */
  modified: boolean;
  permissionCodes: string[];
  userCount: number;
  updatedAt: Date;
}

/** A role as Diffusion's administration shows it: RoleView and its archive state. */
export interface RoleListItem extends RoleView {
  /** Its codes (same as permissionCodes). */
  permissions: string[];
  usersCount: number;
  companyId: string;
  company: { id: string; name: string };
  archivedAt: Date | null;
  archivedBy: { id: string; name: string } | null;
  formerUsersCount: number;
  createdAt: Date;
}

export interface RoleDetail extends RoleListItem {
  holders: { id: string; firstName: string; lastName: string; email: string }[];
}

export interface CreateRoleInput {
  name: string;
  description?: string | null;
  /** Starts from another role's permissions. */
  copyFromId?: string;
  permissions?: string[];
}

export interface UpdateRoleInput {
  name?: string;
  description?: string | null;
  /** Diffusion's form sends the whole set with the name. */
  permissions?: string[];
}

/** A person's roles. */
export interface UserRolesView {
  userId: string;
  roles: { id: string; code: string; name: string }[];
  permissions: string[];
}

/** An error the core's console knows by its `code` (app-admin API). */
function refused(
  code: string,
  status: HttpStatus,
  message: string,
  params?: Record<string, unknown>,
) {
  return new HttpException(
    { code, message, ...(params ? { params } : {}) },
    status,
  );
}

const toView = (role: RoleRow): RoleListItem => {
  const codes = role.rolePermissions.map((rp) => rp.permission.code).sort();
  const defaults = role.isSystem ? defaultPermissionsOf(role.code) : undefined;
  return {
    id: role.id,
    code: role.code,
    name: role.name,
    description: role.description,
    isSystem: role.isSystem,
    modified:
      !!defaults &&
      (defaults.length !== codes.length ||
        defaults.some((code) => !codes.includes(code))),
    permissionCodes: codes,
    permissions: codes,
    userCount: role._count.userRoles,
    usersCount: role._count.userRoles,
    companyId: role.companyId,
    company: role.company,
    archivedAt: role.archivedAt,
    archivedBy: role.archivedBy,
    formerUsersCount: role.formerUsersCount,
    createdAt: role.createdAt,
    updatedAt: role.updatedAt,
  };
};

/** Splits a person's name into first and last (Diffusion keeps one `name`). */
function splitName(name: string): { firstName: string; lastName: string } {
  const at = name.indexOf(' ');
  return at < 0
    ? { firstName: name, lastName: '' }
    : { firstName: name.slice(0, at), lastName: name.slice(at + 1) };
}

/**
 * Diffusion's roles, as EXPENZO's RolesService: a role belongs to one company; the company's
 * protected ADMIN role holds every permission (CDC G1). Used by Diffusion's administration (its
 * own screens) and by the core's console through the app-admin API (the core checked the
 * administrator's right). The CDC rules:
 * - G3: nobody changes their own roles from Diffusion (CANNOT_MODIFY_SELF), unless acting from
 *   the core's console;
 * - G4: no escalation — one grants only codes one holds (PERMISSION_NOT_HELD), and gives only
 *   roles whose codes one all holds; skipped for the core's console;
 * - G5: a role is never deleted, it is archived (its holders lose it, or get a replacement) and
 *   restorable; ADMIN is never archived nor edited (SYSTEM_ROLE_PROTECTED);
 * - G6: every change of a role, its permissions or its holders is audited with before/after.
 * Every change reaches the people concerned at once (AppAccessService.refresh).
 */
@Injectable()
export class RoleService {
  constructor(
    private readonly database: DatabaseService,
    private readonly activity: ActivityService,
    private readonly appAccess: AppAccessService,
    private readonly cls: ClsService<AppClsStore>,
  ) {}

  // ------------------------------------------------------------ catalogue

  catalog(): PermissionCatalogView {
    const groups = new Map<string, PermissionCatalogView['groups'][number]>();
    for (const { code, description } of PERMISSION_CATALOG) {
      const key = code.split('.')[0];
      let group = groups.get(key);
      if (!group) {
        group = {
          key,
          labels: PERMISSION_GROUP_LABELS[key] ?? { en: key, fr: key, it: key },
          permissions: [],
        };
        groups.set(key, group);
      }
      group.permissions.push({
        code,
        action: code.slice(key.length + 1),
        description,
        labels: PERMISSION_LABELS[code] ?? {
          en: description,
          fr: description,
          it: description,
        },
      });
    }
    return {
      version: CATALOG_VERSION,
      groups: [...groups.values()],
      implies: IMPLIES,
    };
  }

  // ------------------------------------------------------------------ reads

  /** The company's roles in use (the core's console; archived ones are not offered). */
  async list(companyId: string): Promise<RoleView[]> {
    const roles = await this.database.role.findMany({
      where: { companyId, archivedAt: null },
      include: ROLE_INCLUDE,
      orderBy: [{ isSystem: 'desc' }, { name: 'asc' }],
    });
    return roles.map(toView);
  }

  /** Diffusion's administration: one page, in use or archived, searched. */
  async findAll(
    companyId: string,
    query: {
      skip?: number;
      take?: number;
      archived?: boolean;
      search?: string;
    },
  ) {
    const skip = query.skip ?? 0;
    const take = query.take ?? DEFAULT_TAKE;
    const where: Prisma.RoleWhereInput = {
      companyId,
      archivedAt: query.archived ? { not: null } : null,
      ...(query.search
        ? {
            OR: [
              { name: { contains: query.search, mode: 'insensitive' } },
              { code: { contains: query.search, mode: 'insensitive' } },
            ],
          }
        : {}),
    };
    const [roles, total] = await this.database.$transaction([
      this.database.role.findMany({
        where,
        include: ROLE_INCLUDE,
        orderBy: [{ isSystem: 'desc' }, { name: 'asc' }],
        skip,
        take,
      }),
      this.database.role.count({ where }),
    ]);
    return { data: roles.map(toView), total, skip, take };
  }

  async get(companyId: string, id: string): Promise<RoleDetail> {
    const role = await this.database.role.findFirst({
      where: { id, companyId },
      include: {
        ...ROLE_INCLUDE,
        userRoles: {
          where: { user: { deletedAt: null } },
          select: {
            user: { select: { id: true, name: true, email: true } },
          },
          orderBy: { user: { name: 'asc' } },
        },
      },
    });
    if (!role) throw new NotFoundException(`Role ${id} not found`);
    const { userRoles, ...rest } = role;
    return {
      ...toView(rest),
      holders: userRoles.map(({ user }) => ({
        id: user.id,
        ...splitName(user.name),
        email: user.email,
      })),
    };
  }

  // ---------------------------------------------------------------- changes

  async create(companyId: string, input: CreateRoleInput): Promise<RoleView> {
    let codes = input.permissions ?? [];
    this.assertKnown(codes);
    if (input.copyFromId) {
      const source = await this.row(companyId, input.copyFromId);
      codes = [
        ...source.rolePermissions.map((rp) => rp.permission.code),
        ...codes,
      ];
    }
    const permissions = normalizePermissions(codes);
    this.assertCanGrant(permissions);
    const name = input.name.trim();
    await this.assertNameAvailable(companyId, name);
    const created = await this.database.$transaction(async (tx) => {
      const ids = await permissionIds(tx, permissions);
      return tx.role.create({
        data: {
          companyId,
          code: await this.freeCode(tx, companyId),
          name,
          description: input.description?.trim() || null,
          rolePermissions: {
            create: permissions.map((code) => ({
              permissionId: ids.get(code)!,
            })),
          },
        },
        include: ROLE_INCLUDE,
      });
    });
    await this.journal('role.created', created.id, companyId, {
      metadata: {
        name: created.name,
        permissions,
        ...(input.copyFromId ? { copiedFrom: input.copyFromId } : {}),
      },
    });
    return toView(created);
  }

  async update(
    companyId: string,
    id: string,
    input: UpdateRoleInput,
  ): Promise<RoleListItem> {
    const before = await this.row(companyId, id);
    if (before.archivedAt) {
      throw new BadRequestException(
        'This role is archived — restore it before changing it',
      );
    }
    const data: { name?: string; description?: string | null } = {};
    if (input.name !== undefined && input.name.trim() !== before.name) {
      data.name = input.name.trim();
      await this.assertNameAvailable(companyId, data.name, id);
    }
    if (
      input.description !== undefined &&
      (input.description?.trim() || null) !== before.description
    ) {
      data.description = input.description?.trim() || null;
    }
    if (Object.keys(data).length) {
      await this.database.role.update({ where: { id }, data });
      const changes: Record<string, [unknown, unknown]> = {};
      if (data.name !== undefined) changes.name = [before.name, data.name];
      if (data.description !== undefined)
        changes.description = [before.description, data.description];
      await this.journal('role.updated', id, companyId, { changes });
      // People's records carry the roles' names.
      await this.refreshHolders([id]);
    }
    if (input.permissions !== undefined) {
      return this.setPermissions(companyId, id, input.permissions);
    }
    return toView(await this.row(companyId, id));
  }

  async setPermissions(
    companyId: string,
    id: string,
    codes: string[],
  ): Promise<RoleListItem> {
    const role = await this.row(companyId, id);
    if (role.code === ADMIN_ROLE_CODE && role.isSystem) {
      // The admin role always holds every permission (CDC G1).
      throw refused(
        'SYSTEM_ROLE_PROTECTED',
        HttpStatus.CONFLICT,
        'The ADMIN role always holds every permission',
      );
    }
    if (role.archivedAt) {
      throw new BadRequestException(
        'This role is archived — restore it before changing it',
      );
    }
    this.assertKnown(codes);
    const before = role.rolePermissions.map((rp) => rp.permission.code).sort();
    const after: string[] = normalizePermissions(codes);
    const granted = after.filter((code) => !before.includes(code));
    const revoked = before.filter((code) => !after.includes(code));
    this.assertCanGrant(granted);
    if (granted.length === 0 && revoked.length === 0) return toView(role);
    await this.database.$transaction(async (tx) => {
      await this.writePermissions(tx, id, after);
      await tx.role.update({ where: { id }, data: { updatedAt: new Date() } });
    });
    await this.journal('role.updated', id, companyId, {
      changes: { permissions: [before, after] },
      metadata: { name: role.name, added: granted, removed: revoked },
    });
    await this.refreshHolders([id]);
    return toView(await this.row(companyId, id));
  }

  /** A default role back to its default permissions. */
  async restoreDefaults(companyId: string, id: string): Promise<RoleListItem> {
    const role = await this.row(companyId, id);
    const defaults = role.isSystem
      ? defaultPermissionsOf(role.code)
      : undefined;
    if (!defaults) {
      throw refused(
        'ROLE_HAS_NO_DEFAULTS',
        HttpStatus.CONFLICT,
        'Only a default role has default permissions',
      );
    }
    if (role.code === ADMIN_ROLE_CODE) {
      // Never changed from here, but completed when the catalogue grew.
      await this.database.$transaction((tx) =>
        this.writePermissions(tx, id, ALL_PERMISSIONS),
      );
      await this.refreshHolders([id]);
      return toView(await this.row(companyId, id));
    }
    const view = await this.setPermissions(companyId, id, [...defaults]);
    await this.journal('role.defaults-restored', id, companyId, {
      metadata: { name: role.name },
    });
    return view;
  }

  /**
   * CDC G5: a role is never deleted. Archived, it is held by nobody any more and offered nowhere,
   * and can be restored. Its holders lose it, or get `reassignToRoleId` instead (a role of the
   * same company); so do the delegations still running.
   */
  async archive(
    companyId: string,
    id: string,
    { reassignToRoleId }: { reassignToRoleId?: string } = {},
  ) {
    const role = await this.row(companyId, id);
    this.assertNotAdmin(role);
    if (role.archivedAt) {
      throw new BadRequestException('This role is already archived');
    }
    if (reassignToRoleId) {
      if (reassignToRoleId === id) {
        throw new BadRequestException('A role cannot replace itself');
      }
      const replacement = await this.database.role.findUnique({
        where: { id: reassignToRoleId },
        include: ROLE_INCLUDE,
      });
      if (!replacement) {
        throw new NotFoundException(`Role ${reassignToRoleId} not found`);
      }
      if (replacement.archivedAt) {
        throw new BadRequestException('The replacement role is archived');
      }
      if (replacement.companyId !== companyId) {
        throw new BadRequestException(
          'The replacement role belongs to another company',
        );
      }
      // Giving the replacement grants its permissions: G4.
      this.assertCanGrant(
        replacement.rolePermissions.map((rp) => rp.permission.code),
      );
    }
    const affected = await this.holdersOf([id]);
    const now = new Date();
    const actorId = this.actorId();
    const holders = await this.database.$transaction(async (tx) => {
      const grants = await tx.userRole.findMany({
        where: { roleId: id },
        select: { userId: true },
      });
      if (reassignToRoleId && grants.length) {
        await tx.userRole.createMany({
          data: grants.map((grant) => ({
            userId: grant.userId,
            roleId: reassignToRoleId,
          })),
          skipDuplicates: true,
        });
      }
      await tx.userRole.deleteMany({ where: { roleId: id } });
      // Delegations still running: handed the replacement, or ended now.
      const running = { roleId: id, endDate: { gte: now } };
      if (reassignToRoleId) {
        await tx.delegation.updateMany({
          where: running,
          data: { roleId: reassignToRoleId },
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
      const formerUsersCount = new Set(grants.map((grant) => grant.userId))
        .size;
      const archivedBy = actorId
        ? await tx.user.count({ where: { id: actorId } })
        : 0;
      await tx.role.update({
        where: { id },
        data: {
          archivedAt: now,
          archivedById: archivedBy ? actorId : null,
          formerUsersCount,
        },
      });
      return formerUsersCount;
    });
    await this.journal('role.archived', id, companyId, {
      changes: { archivedAt: [null, now] },
      metadata: {
        name: role.name,
        holders,
        reassignedToRoleId: reassignToRoleId ?? null,
      },
    });
    await this.appAccess.refresh(affected);
    return {
      ...toView(await this.row(companyId, id)),
      holders,
      reassignedToRoleId: reassignToRoleId ?? null,
    };
  }

  /**
   * The core's console deletes a role (EXPENZO's DELETE): Diffusion archives it (G5). A role
   * still held is refused (ROLE_IN_USE), like EXPENZO; ADMIN never (SYSTEM_ROLE_PROTECTED).
   */
  async remove(companyId: string, id: string): Promise<void> {
    const role = await this.row(companyId, id);
    this.assertNotAdmin(role);
    if (role.archivedAt) return;
    if (role._count.userRoles > 0) {
      throw refused(
        'ROLE_IN_USE',
        HttpStatus.CONFLICT,
        'This role is still held: take it from its holders first',
        { users: role._count.userRoles },
      );
    }
    await this.archive(companyId, id);
  }

  /** Back in use, held by nobody: its former holders are not given it back. */
  async unarchive(companyId: string, id: string, note?: string) {
    const role = await this.row(companyId, id);
    if (!role.archivedAt) {
      throw new BadRequestException('This role is not archived');
    }
    await this.assertNameAvailable(companyId, role.name, id);
    await this.database.role.update({
      where: { id },
      data: { archivedAt: null, archivedById: null, formerUsersCount: 0 },
    });
    await this.journal('role.restored', id, companyId, {
      changes: { archivedAt: [role.archivedAt, null] },
      metadata: { name: role.name, ...(note ? { note } : {}) },
    });
    return this.get(companyId, id);
  }

  // ---------------------------------------------------------------- holders

  /** People's roles in the company (the core's console: its user list and user page). */
  async userRoles(
    companyId: string,
    userIds: string[],
  ): Promise<UserRolesView[]> {
    const users = await this.database.user.findMany({
      where: { id: { in: userIds }, companyId },
      select: {
        id: true,
        userRoles: {
          where: { role: { companyId, archivedAt: null } },
          select: { role: { select: { id: true, code: true, name: true } } },
          orderBy: { role: { name: 'asc' } },
        },
      },
    });
    const access = await this.appAccess.compute(users.map((u) => u.id));
    return users.map((user) => ({
      userId: user.id,
      roles: user.userRoles.map((ur) => ur.role),
      permissions: access.get(user.id)?.permissions ?? [],
    }));
  }

  /** Replaces a person's roles in their company. */
  async setUserRoles(
    companyId: string,
    userId: string,
    roleIds: string[],
  ): Promise<UserRolesView> {
    const actor = this.actorId();
    if (!this.coreActor() && actor === userId) {
      // G3: nobody changes their own roles from Diffusion (no self-promotion, no lock-out).
      throw refused(
        'CANNOT_MODIFY_SELF',
        HttpStatus.FORBIDDEN,
        'You cannot change your own roles',
      );
    }
    const user = await this.database.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        name: true,
        companyId: true,
        userRoles: {
          where: { role: { companyId } },
          select: { roleId: true, role: { select: { name: true } } },
        },
      },
    });
    if (!user) throw new NotFoundException(`User ${userId} not found`);
    if (user.companyId !== companyId) {
      throw new ForbiddenException('This person belongs to another company');
    }
    const wanted = [...new Set(roleIds)];
    const roles = await this.database.role.findMany({
      where: { id: { in: wanted } },
      select: {
        id: true,
        name: true,
        companyId: true,
        archivedAt: true,
        rolePermissions: { select: { permission: { select: { code: true } } } },
      },
    });
    const missing = wanted.filter((id) => !roles.some((r) => r.id === id));
    if (missing.length) {
      throw new NotFoundException(`Unknown roles: ${missing.join(', ')}`);
    }
    const elsewhere = roles.filter((r) => r.companyId !== companyId);
    if (elsewhere.length) {
      throw new BadRequestException(
        `Roles of another company: ${elsewhere.map((r) => r.name).join(', ')}`,
      );
    }
    const held = user.userRoles.map((r) => r.roleId);
    const added = roles.filter((r) => !held.includes(r.id));
    const archived = added.filter((r) => r.archivedAt);
    if (archived.length) {
      throw new BadRequestException(
        `Archived roles cannot be granted: ${archived.map((r) => r.name).join(', ')}`,
      );
    }
    const removed = user.userRoles.filter((r) => !wanted.includes(r.roleId));
    // G4: giving a role grants its permissions — only roles within one's own.
    this.assertCanGrant(
      added.flatMap((r) => r.rolePermissions.map((rp) => rp.permission.code)),
    );
    if (added.length || removed.length) {
      const before = user.userRoles.map((r) => r.role.name).sort();
      await this.database.$transaction(async (tx) => {
        await tx.userRole.deleteMany({
          where: { userId, roleId: { in: removed.map((r) => r.roleId) } },
        });
        await tx.userRole.createMany({
          data: added.map((r) => ({ userId, roleId: r.id })),
          skipDuplicates: true,
        });
      });
      const after = roles.map((r) => r.name).sort();
      await this.activity.tryRecord({
        action: 'user.roles.updated',
        entityType: 'user',
        entityId: userId,
        companyId,
        changes: { roles: [before, after] },
        metadata: {
          name: user.name,
          added: added.map((r) => r.name),
          removed: removed.map((r) => r.role.name),
        },
      });
      await this.appAccess.refresh([userId]);
    }
    const [view] = await this.userRoles(companyId, [userId]);
    return view;
  }

  /** Active people of the company holding none of its roles. */
  async peopleWithoutRole(companyId: string): Promise<string[]> {
    const users = await this.database.user.findMany({
      where: {
        companyId,
        status: UserStatus.ACTIVE,
        userRoles: { none: { role: { companyId, archivedAt: null } } },
      },
      select: { id: true },
    });
    return users.map((u) => u.id);
  }

  // ---------------------------------------------------------------- helpers

  private actorId(): string | undefined {
    return this.cls.isActive() ? this.cls.get('userId') : undefined;
  }

  private coreActor() {
    return this.cls.isActive() ? this.cls.get('coreActor') : undefined;
  }

  /** G4: Diffusion's own screens grant only codes the person holds (not the core's console). */
  private assertCanGrant(codes: readonly string[]): void {
    if (!this.cls.isActive() || this.coreActor()) return;
    const held = this.cls.get('permissions');
    if (!held) return;
    const missing = [...new Set(codes)].filter((code) => !held.includes(code));
    if (missing.length) {
      throw refused(
        'PERMISSION_NOT_HELD',
        HttpStatus.FORBIDDEN,
        `You can only grant permissions you hold: ${missing.join(', ')}`,
        { permissions: missing },
      );
    }
  }

  private assertKnown(codes: readonly string[]): void {
    const unknown = codes.filter((code) => !isPermission(code));
    if (unknown.length) {
      throw refused(
        'UNKNOWN_PERMISSION',
        HttpStatus.BAD_REQUEST,
        `Unknown permissions: ${unknown.join(', ')}`,
        { permissions: unknown },
      );
    }
  }

  private assertNotAdmin(role: RoleRow): void {
    if (role.code === ADMIN_ROLE_CODE && role.isSystem) {
      throw refused(
        'SYSTEM_ROLE_PROTECTED',
        HttpStatus.CONFLICT,
        'The ADMIN role is never archived',
      );
    }
  }

  private async assertNameAvailable(
    companyId: string,
    name: string,
    exceptId?: string,
  ): Promise<void> {
    const taken = await this.database.role.findFirst({
      where: {
        companyId,
        name: { equals: name, mode: 'insensitive' },
        ...(exceptId ? { id: { not: exceptId } } : {}),
      },
      select: { id: true },
    });
    if (taken) {
      throw new ConflictException({
        code: 'UNIQUE_CONSTRAINT',
        message: `A role named "${name}" already exists`,
        params: { field: 'name' },
      });
    }
  }

  private async freeCode(
    tx: Prisma.TransactionClient,
    companyId: string,
  ): Promise<string> {
    for (;;) {
      const code = generateReference('RO');
      const taken = await tx.role.count({ where: { companyId, code } });
      if (!taken) return code;
    }
  }

  private async writePermissions(
    tx: Prisma.TransactionClient,
    roleId: string,
    codes: readonly string[],
  ): Promise<void> {
    const ids = await permissionIds(tx, codes);
    const wanted = codes.map((code) => ids.get(code)!).filter(Boolean);
    await tx.rolePermission.deleteMany({
      where: { roleId, permissionId: { notIn: wanted } },
    });
    await tx.rolePermission.createMany({
      data: wanted.map((permissionId) => ({ roleId, permissionId })),
      skipDuplicates: true,
    });
  }

  private async row(companyId: string, id: string): Promise<RoleRow> {
    const role = await this.database.role.findFirst({
      where: { id, companyId },
      include: ROLE_INCLUDE,
    });
    if (!role) throw new NotFoundException(`Role ${id} not found`);
    return role;
  }

  /** Who holds these roles, directly or through a delegation in force. */
  private async holdersOf(roleIds: string[]): Promise<string[]> {
    const [grants, delegated] = await Promise.all([
      this.database.userRole.findMany({
        where: { roleId: { in: roleIds } },
        select: { userId: true },
      }),
      this.database.delegation.findMany({
        where: { roleId: { in: roleIds }, ...activeDelegationsFilter() },
        select: { delegataireId: true },
      }),
    ]);
    return [
      ...new Set([
        ...grants.map((g) => g.userId),
        ...delegated.map((d) => d.delegataireId),
      ]),
    ];
  }

  private async refreshHolders(roleIds: string[]): Promise<void> {
    await this.appAccess.refresh(await this.holdersOf(roleIds));
  }

  // G6: every change to a role, with its permissions before / after.
  private journal(
    action: string,
    roleId: string,
    companyId: string,
    extra: {
      changes?: Record<string, [unknown, unknown]>;
      metadata?: Record<string, unknown>;
    } = {},
  ) {
    return this.activity.tryRecord({
      action,
      entityType: 'role',
      entityId: roleId,
      companyId,
      ...extra,
    });
  }
}
