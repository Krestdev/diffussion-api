import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  AccessProfile,
  Prisma,
  UserStatus,
} from '../../../generated/prisma/client';
import { ActivityService } from '../../activity/activity.service';
import { PermissionCode } from '../../auth/rbac/rbac.constants';
import {
  assertAdministers,
  assertInScope,
  RbacService,
  SiteScopeList,
} from '../../auth/rbac/rbac.service';
import { DEFAULT_TAKE } from '../../common/dto/pagination.query.dto';
import { AppAccessService } from '../../core/app-access.service';
import { DatabaseService } from '../../database/database.service';
import { NotificationsService } from '../../notifications/notifications.service';
import { RealtimeGateway } from '../../realtime/realtime.gateway';
import { FindDirectoryQueryDto } from './dto/find-directory.query.dto';
import { FindUsersQueryDto } from './dto/find-users.query.dto';
import { UpdateUserDto } from './dto/update-user.dto';

const userInclude = {
  userRoles: { include: { role: true } },
  site: true,
  deactivatedBy: { select: { id: true, name: true } },
} satisfies Prisma.UserInclude;

function toView(user: Prisma.UserGetPayload<{ include: typeof userInclude }>) {
  const { userRoles, ...rest } = user;
  return { ...rest, roles: userRoles.map((ur) => ur.role) };
}

// A user's roles are all held at their site, or globally for a platform
// user (no site) — see UserRole.
function grantsAt(roleIds: string[], siteId: string | null) {
  return roleIds.map((roleId) => ({ roleId, siteId }));
}

/**
 * People as Diffusion sees them. Who they are (name, email, phone, job
 * title, status, company = site) comes from the CREAPP core's directory
 * (DirectorySyncService): they are created, invited, suspended and edited in
 * the core's console. Diffusion gives them its roles.
 */
@Injectable()
export class UsersService {
  constructor(
    private readonly database: DatabaseService,
    private readonly rbac: RbacService,
    private readonly realtime: RealtimeGateway,
    private readonly activity: ActivityService,
    private readonly notifications: NotificationsService,
    private readonly appAccess: AppAccessService,
  ) {}

  // The audit journal (AU·1): role grants and profiles.
  private journal(
    action: string,
    userId: string,
    extra: {
      changes?: Record<string, [unknown, unknown]>;
      metadata?: Record<string, unknown>;
    } = {},
  ) {
    return this.activity.tryRecord({
      action,
      entityType: 'user',
      entityId: userId,
      ...extra,
    });
  }
  async findAll(query: FindUsersQueryDto, actingUserId: string) {
    const scope = await this.adminScope(actingUserId);
    const skip = query.skip ?? 0;
    const take = query.take ?? DEFAULT_TAKE;
    const where: Prisma.UserWhereInput = {
      AND: [
        scope === 'ALL' ? {} : { siteId: { in: scope } },
        query.siteId ? { siteId: query.siteId } : {},
      ],
      status: query.status,
      OR: query.search
        ? [
            { name: { contains: query.search, mode: 'insensitive' } },
            { email: { contains: query.search, mode: 'insensitive' } },
            {
              registrationNumber: {
                contains: query.search,
                mode: 'insensitive',
              },
            },
          ]
        : undefined,
    };
    const [users, total] = await this.database.$transaction([
      this.database.user.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        include: userInclude,
        skip,
        take,
      }),
      this.database.user.count({ where }),
    ]);
    return { data: users.map(toView), total, skip, take };
  }

  async findOne(id: string, actingUserId: string) {
    const scope = await this.adminScope(actingUserId);
    const user = await this.database.user.findUnique({
      where: { id },
      include: userInclude,
    });
    if (!user) {
      throw new NotFoundException(`User ${id} not found`);
    }
    assertInScope(scope, user.siteId);
    return toView(user);
  }

  async update(id: string, dto: UpdateUserDto, actingUserId: string) {
    const scope = await this.adminScope(actingUserId);
    const existing = await this.ensureExists(id);
    assertInScope(scope, existing.siteId);
    // A platform administrator's profile is theirs to change only.
    if (
      dto.accessProfile !== undefined ||
      existing.accessProfile === AccessProfile.SUPER_ADMIN
    ) {
      this.assertProfileAllowed(
        scope,
        dto.accessProfile ?? existing.accessProfile,
      );
    }
    const { roleIds, accessProfile } = dto;
    const siteId = existing.siteId;
    await this.assertRolesGrantable(roleIds, siteId);

    const rolesBefore = (
      await this.database.userRole.findMany({
        where: { userId: id },
        select: { role: { select: { name: true } } },
      })
    )
      .map((grant) => grant.role?.name)
      .filter((name): name is string => Boolean(name))
      .sort();

    // A global grant isn't turned into a grant at the user's site: it stays
    // if the role is still listed, and always for a site administrator, who
    // has no say on platform rights.
    const keptGlobal = roleIds
      ? (
          await this.database.userRole.findMany({
            where: { userId: id, siteId: null },
            select: { roleId: true },
          })
        )
          .map((grant) => grant.roleId)
          .filter(
            (roleId) =>
              siteId !== null && (scope !== 'ALL' || roleIds.includes(roleId)),
          )
      : [];

    // Guarded: replacing the role set may strip the last admin's rights.
    const user = await this.rbac.withAdminCoverage((tx) =>
      tx.user.update({
        where: { id },
        data: {
          accessProfile,
          userRoles: roleIds
            ? {
                deleteMany: keptGlobal.length
                  ? { NOT: { siteId: null, roleId: { in: keptGlobal } } }
                  : {},
                create: grantsAt(
                  [...new Set(roleIds)].filter(
                    (roleId) => !keptGlobal.includes(roleId),
                  ),
                  siteId,
                ),
              }
            : undefined,
        },
        include: userInclude,
      }),
    );
    this.realtime.broadcast('user:update', { id: user.id });
    const view = toView(user);
    const rolesAfter = view.roles.map((role) => role.name).sort();
    const added = rolesAfter.filter((name) => !rolesBefore.includes(name));
    const removed = rolesBefore.filter((name) => !rolesAfter.includes(name));
    if (added.length || removed.length) {
      await this.journal('user.roles.updated', id, {
        changes: { roles: [rolesBefore, rolesAfter] },
        metadata: { added, removed },
      });
      // The core's launcher and the person's other tabs follow at once.
      await this.appAccess.refresh([id]);
      await this.notifications.notifyAccessChanged(
        [id],
        actingUserId,
        [
          added.length ? `Rôle attribué : ${added.join(', ')}.` : '',
          removed.length ? `Rôle retiré : ${removed.join(', ')}.` : '',
        ]
          .filter(Boolean)
          .join(' '),
      );
    }
    if (existing.accessProfile !== user.accessProfile) {
      await this.journal('user.access-profile.updated', id, {
        changes: {
          accessProfile: [existing.accessProfile, user.accessProfile],
        },
      });
    }
    return view;
  }
  // -------------------------------------------------------------- directory

  /**
   * The people pickers (superviseur, agents, validateur, signataire...):
   * readable by every signed-in user, unlike the administration list. The
   * active people of the caller's own site — any site for a platform
   * administrator — with only what a picker shows. `ids` resolves people
   * already chosen, whatever their site or status.
   */
  async directory(query: FindDirectoryQueryDto, actingUserId: string) {
    const select = {
      id: true,
      name: true,
      email: true,
      function: true,
      siteId: true,
      status: true,
    } satisfies Prisma.UserSelect;
    const take = query.take ?? 200;

    if (query.ids?.length) {
      return this.database.user.findMany({
        where: { id: { in: query.ids } },
        select,
        orderBy: { name: 'asc' },
      });
    }

    const global = await this.rbac.hasGlobalPermission(
      actingUserId,
      PermissionCode.AdminManageUsers,
    );
    let siteId = query.siteId;
    if (!global) {
      const me = await this.database.user.findUnique({
        where: { id: actingUserId },
        select: { siteId: true },
      });
      // Their own site's people only.
      if (!me?.siteId || (siteId && siteId !== me.siteId)) return [];
      siteId = me.siteId;
    }

    const now = new Date();
    const holds = query.permission
      ? {
          role: {
            archivedAt: null,
            rolePermissions: {
              some: { permission: { code: query.permission } },
            },
          },
        }
      : undefined;
    const where: Prisma.UserWhereInput = {
      status: UserStatus.ACTIVE,
      ...(siteId ? { siteId } : {}),
      AND: [
        holds
          ? {
              OR: [
                {
                  userRoles: {
                    some: {
                      ...holds,
                      ...(siteId ? { OR: [{ siteId }, { siteId: null }] } : {}),
                    },
                  },
                },
                {
                  delegationsReceived: {
                    some: {
                      ...holds,
                      ...(siteId ? { siteId } : {}),
                      startDate: { lte: now },
                      endDate: {
                        gte: new Date(
                          now.getFullYear(),
                          now.getMonth(),
                          now.getDate(),
                        ),
                      },
                    },
                  },
                },
              ],
            }
          : {},
        query.search
          ? {
              OR: [
                { name: { contains: query.search, mode: 'insensitive' } },
                { email: { contains: query.search, mode: 'insensitive' } },
                { function: { contains: query.search, mode: 'insensitive' } },
              ],
            }
          : {},
      ],
    };
    return this.database.user.findMany({
      where,
      select,
      orderBy: { name: 'asc' },
      take,
    });
  }

  // SUPER_ADMIN is granted by a platform administrator only.
  private assertProfileAllowed(
    scope: SiteScopeList,
    profile: AccessProfile | undefined,
  ) {
    if (profile === AccessProfile.SUPER_ADMIN && scope !== 'ALL') {
      throw new ForbiddenException(
        'Only a platform administrator can manage a SUPER_ADMIN profile',
      );
    }
  }

  // 'ALL' for a platform administrator, else the site they are the
  // responsible of; anyone else is refused.
  private async adminScope(actingUserId: string): Promise<SiteScopeList> {
    const scope = await this.rbac.administeredSites(
      actingUserId,
      PermissionCode.AdminManageUsers,
    );
    assertAdministers(scope);
    return scope;
  }

  private async ensureExists(id: string) {
    const user = await this.database.user.findUnique({ where: { id } });
    if (!user) {
      throw new NotFoundException(`User ${id} not found`);
    }
    return user;
  }

  // Known, not archived, global or of the user's own site.
  private async assertRolesGrantable(
    roleIds: string[] | undefined,
    siteId: string | null,
  ) {
    if (!roleIds?.length) return;
    const found = await this.database.role.findMany({
      where: { id: { in: roleIds } },
      select: { id: true, name: true, siteId: true, archivedAt: true },
    });
    const missing = roleIds.filter((id) => !found.some((r) => r.id === id));
    if (missing.length) {
      throw new BadRequestException(`Unknown role ids: ${missing.join(', ')}`);
    }
    const archived = found.filter((role) => role.archivedAt);
    if (archived.length) {
      throw new BadRequestException(
        `Archived roles cannot be granted: ${archived.map((role) => role.name).join(', ')}`,
      );
    }
    const elsewhere = found.filter(
      (role) => role.siteId !== null && role.siteId !== siteId,
    );
    if (elsewhere.length) {
      throw new BadRequestException(
        `Roles of another site: ${elsewhere.map((role) => role.name).join(', ')}`,
      );
    }
  }
}
