import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  AccessProfile,
  Prisma,
  UserStatus,
} from '../../generated/prisma/client';
import { ActivityService } from '../../activity/activity.service';
import {
  AccessService,
  activeDelegationsFilter,
} from '../../auth/access/access.service';
import { forbidden } from '../../auth/access/permissions.guard';
import { Permission } from '../../auth/permissions';
import { DEFAULT_TAKE } from '../../common/dto/pagination.query.dto';
import { DatabaseService } from '../../database/database.service';
import { NotificationsService } from '../../notifications/notifications.service';
import { RealtimeGateway } from '../../realtime/realtime.gateway';
import { RoleService } from '../role/role.service';
import { FindDirectoryQueryDto } from './dto/find-directory.query.dto';
import { FindUsersQueryDto } from './dto/find-users.query.dto';
import { UpdateUserDto } from './dto/update-user.dto';

const userInclude = {
  userRoles: { include: { role: true } },
  company: true,
  deactivatedBy: { select: { id: true, name: true } },
} satisfies Prisma.UserInclude;

function toView(user: Prisma.UserGetPayload<{ include: typeof userInclude }>) {
  const { userRoles, ...rest } = user;
  return {
    ...rest,
    // The roles of their company (a role belongs to one company), in use.
    roles: userRoles
      .map((ur) => ur.role)
      .filter((role) => role.companyId === user.companyId && !role.archivedAt),
  };
}

/**
 * People as Diffusion sees them. Who they are (name, email, phone, job
 * title, status, company) comes from the CREAPP core's directory
 * (DirectorySyncService): they are created, invited, suspended and edited in
 * the core's console. Diffusion gives them its roles.
 */
@Injectable()
export class UsersService {
  constructor(
    private readonly database: DatabaseService,
    private readonly access: AccessService,
    private readonly realtime: RealtimeGateway,
    private readonly activity: ActivityService,
    private readonly notifications: NotificationsService,
    private readonly roles: RoleService,
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
  /** The administration list: the people of the person's company (user.read). */
  async findAll(query: FindUsersQueryDto, actingUserId: string) {
    const companyId = await this.adminCompany(
      actingUserId,
      Permission.USER_READ,
    );
    const skip = query.skip ?? 0;
    const take = query.take ?? DEFAULT_TAKE;
    const where: Prisma.UserWhereInput = {
      AND: [
        { companyId },
        query.companyId ? { companyId: query.companyId } : {},
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
    const companyId = await this.adminCompany(
      actingUserId,
      Permission.USER_READ,
    );
    const user = await this.database.user.findUnique({
      where: { id },
      include: userInclude,
    });
    if (!user) {
      throw new NotFoundException(`User ${id} not found`);
    }
    if (user.companyId !== companyId) {
      throw new ForbiddenException('This person belongs to another company');
    }
    return toView(user);
  }

  /**
   * Their roles (role.assign; CDC G3 no self-edit, G4 only roles within one's own permissions —
   * RoleService.setUserRoles) and their profile. SUPER_ADMIN is given or taken by a
   * super-administrator only.
   */
  async update(id: string, dto: UpdateUserDto, actingUserId: string) {
    const companyId = await this.adminCompany(
      actingUserId,
      Permission.ROLE_ASSIGN,
    );
    const existing = await this.ensureExists(id);
    if (existing.companyId !== companyId) {
      throw new ForbiddenException('This person belongs to another company');
    }
    const profileChanges =
      dto.accessProfile !== undefined &&
      dto.accessProfile !== existing.accessProfile;
    if (
      profileChanges &&
      (dto.accessProfile === AccessProfile.SUPER_ADMIN ||
        existing.accessProfile === AccessProfile.SUPER_ADMIN) &&
      !(await this.access.isPlatformAdmin(actingUserId))
    ) {
      throw new ForbiddenException(
        'Only a Diffusion super-administrator can manage a SUPER_ADMIN profile',
      );
    }

    if (dto.roleIds) {
      const before = await this.roleNames(id, companyId);
      await this.roles.setUserRoles(companyId, id, dto.roleIds);
      const after = await this.roleNames(id, companyId);
      const added = after.filter((name) => !before.includes(name));
      const removed = before.filter((name) => !after.includes(name));
      if (added.length || removed.length) {
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
    }
    if (profileChanges) {
      await this.database.user.update({
        where: { id },
        data: { accessProfile: dto.accessProfile },
      });
      await this.journal('user.access-profile.updated', id, {
        changes: { accessProfile: [existing.accessProfile, dto.accessProfile] },
      });
    }
    const user = await this.database.user.findUniqueOrThrow({
      where: { id },
      include: userInclude,
    });
    this.realtime.broadcast('user:update', { id: user.id });
    return toView(user);
  }

  private async roleNames(userId: string, companyId: string) {
    const grants = await this.database.userRole.findMany({
      where: { userId, role: { companyId, archivedAt: null } },
      select: { role: { select: { name: true } } },
    });
    return grants.map((grant) => grant.role.name).sort();
  }

  // -------------------------------------------------------------- directory

  /**
   * The people pickers (superviseur, agents, validateur, signataire...):
   * readable by every signed-in user, unlike the administration list. The
   * active people of the caller's own company — any company for a platform
   * administrator — with only what a picker shows. `ids` resolves people
   * already chosen, whatever their company or status.
   */
  async directory(query: FindDirectoryQueryDto, actingUserId: string) {
    const select = {
      id: true,
      name: true,
      email: true,
      function: true,
      companyId: true,
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

    // Their own company's people only.
    const own = await this.access.companyOf(actingUserId);
    if (!own || (query.companyId && query.companyId !== own)) return [];
    const companyId = own;

    const holds = query.permission
      ? {
          role: {
            companyId,
            archivedAt: null,
            rolePermissions: {
              some: { permission: { code: query.permission } },
            },
          },
        }
      : undefined;
    const where: Prisma.UserWhereInput = {
      status: UserStatus.ACTIVE,
      companyId,
      AND: [
        holds
          ? {
              OR: [
                { userRoles: { some: holds } },
                {
                  delegationsReceived: {
                    some: {
                      ...holds,
                      companyId,
                      ...activeDelegationsFilter(),
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

  /** The person's company, when they hold `permission` there (403 otherwise). */
  private async adminCompany(
    actingUserId: string,
    permission: Permission,
  ): Promise<string> {
    const [companyId] = await this.access.scope(actingUserId, permission);
    if (!companyId) throw forbidden(permission);
    return companyId;
  }

  private async ensureExists(id: string) {
    const user = await this.database.user.findUnique({ where: { id } });
    if (!user) {
      throw new NotFoundException(`User ${id} not found`);
    }
    return user;
  }
}
