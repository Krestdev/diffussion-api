import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import {
  Prisma,
  SiteStatus,
  UserStatus,
} from '../../../generated/prisma/client';
import { PermissionCode } from '../../auth/rbac/rbac.constants';
import {
  assertAdministers,
  assertInScope,
  RbacService,
  SiteScopeList,
} from '../../auth/rbac/rbac.service';
import { DEFAULT_TAKE } from '../../common/dto/pagination.query.dto';
import { DatabaseService } from '../../database/database.service';
import { RealtimeGateway } from '../../realtime/realtime.gateway';
import { CreateUserDto } from './dto/create-user.dto';
import { FindUsersQueryDto } from './dto/find-users.query.dto';
import { UpdateUserDto } from './dto/update-user.dto';

const SALT_ROUNDS = 10;

const userInclude = {
  userRoles: { include: { role: true } },
  site: true,
} satisfies Prisma.UserInclude;

function toView(user: Prisma.UserGetPayload<{ include: typeof userInclude }>) {
  // password/refreshToken destructured solely to exclude them from `rest`
  // before it goes out over the API.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { userRoles, password, refreshToken, ...rest } = user;
  return { ...rest, roles: userRoles.map((ur) => ur.role) };
}

// A user's roles are all held at their site, or globally for a platform
// user (no site) — see UserRole.
function grantsAt(roleIds: string[], siteId: string | null) {
  return roleIds.map((roleId) => ({ roleId, siteId }));
}

@Injectable()
export class UsersService {
  constructor(
    private readonly database: DatabaseService,
    private readonly rbac: RbacService,
    private readonly realtime: RealtimeGateway,
  ) {}

  async create(dto: CreateUserDto, actingUserId: string) {
    const scope = await this.adminScope(actingUserId);
    const { roleIds = [], siteId: requestedSiteId, password, ...data } = dto;
    const siteId = this.siteForNewUser(scope, requestedSiteId);
    assertInScope(scope, siteId);
    await this.assertEmailAvailable(dto.email);
    await this.assertReferencesExist(roleIds, siteId);

    const user = await this.database.user.create({
      data: {
        ...data,
        siteId,
        password: await bcrypt.hash(password, SALT_ROUNDS),
        status: UserStatus.ACTIVE,
        userRoles: roleIds.length
          ? { create: grantsAt(roleIds, siteId) }
          : undefined,
      },
      include: userInclude,
    });
    this.realtime.broadcast('user:new', { id: user.id });
    return toView(user);
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
    const { roleIds, siteId: requestedSiteId, password, ...data } = dto;
    // `siteId` absent: unchanged; null: becomes a platform user.
    const siteId =
      requestedSiteId === undefined ? existing.siteId : requestedSiteId;
    assertInScope(scope, siteId);
    if (dto.email !== undefined && dto.email !== existing.email) {
      await this.assertEmailAvailable(dto.email);
    }
    await this.assertReferencesExist(roleIds, siteId, existing.siteId);

    // The roles follow the user: re-granted at the new site when it
    // changes (the old site's own roles are dropped), or replaced by
    // `roleIds` when sent.
    const siteChanged = siteId !== existing.siteId;
    if (siteChanged) {
      await this.assertNotResponsible(id);
    }
    const nextRoleIds =
      roleIds ??
      (siteChanged
        ? (
            await this.database.userRole.findMany({
              where: { userId: id, role: { siteId: null } },
              select: { roleId: true },
            })
          ).map((grant) => grant.roleId)
        : undefined);

    const hashedPassword = password
      ? await bcrypt.hash(password, SALT_ROUNDS)
      : undefined;

    // Guarded: replacing the role set may strip the last admin's rights.
    const user = await this.rbac.withAdminCoverage((tx) =>
      tx.user.update({
        where: { id },
        data: {
          ...data,
          siteId,
          password: hashedPassword,
          // A password reset ends every existing session: the refresh
          // token can no longer be exchanged, so the user must log in
          // again with the new password once their access token expires.
          refreshToken: hashedPassword ? null : undefined,
          userRoles: nextRoleIds
            ? {
                deleteMany: {},
                create: grantsAt([...new Set(nextRoleIds)], siteId),
              }
            : undefined,
        },
        include: userInclude,
      }),
    );
    this.realtime.broadcast('user:update', { id: user.id });
    return toView(user);
  }

  async toggleStatus(id: string, actingUserId: string) {
    const scope = await this.adminScope(actingUserId);
    const user = await this.ensureExists(id);
    assertInScope(scope, user.siteId);
    const suspending = user.status === UserStatus.ACTIVE;
    if (suspending && id === actingUserId) {
      throw new BadRequestException('You cannot suspend your own account');
    }

    const updated = await this.rbac.withAdminCoverage((tx) =>
      tx.user.update({
        where: { id },
        data: suspending
          ? {
              status: UserStatus.SUSPENDED,
              refreshToken: null,
              isConnected: false,
            }
          : { status: UserStatus.ACTIVE },
        include: userInclude,
      }),
    );
    this.realtime.broadcast('user:update', { id: updated.id });
    return toView(updated);
  }

  // Membership rows (roles, notification inbox) go with the
  // user; anything that is business history (dossiers, courriers,
  // validations, delegations...) blocks the deletion — suspend instead.
  async remove(id: string, actingUserId: string) {
    const scope = await this.adminScope(actingUserId);
    const user = await this.ensureExists(id);
    assertInScope(scope, user.siteId);
    if (id === actingUserId) {
      throw new BadRequestException('You cannot delete your own account');
    }

    try {
      await this.rbac.withAdminCoverage(async (tx) => {
        await tx.userRole.deleteMany({ where: { userId: id } });
        await tx.userNotification.deleteMany({ where: { userId: id } });
        await tx.user.delete({ where: { id } });
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2003'
      ) {
        throw new ConflictException(
          'User has business history (dossiers, courriers, instructions, validations, delegations...) and cannot be deleted — suspend the account instead',
        );
      }
      throw error;
    }
    this.realtime.broadcast('user:delete', { id });
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

  // A site's responsible belongs to it (SiteService): moving them away
  // would leave the site administered by an outsider.
  private async assertNotResponsible(userId: string) {
    const managed = await this.database.site.findFirst({
      where: { responsibleId: userId },
      select: { name: true },
    });
    if (managed) {
      throw new BadRequestException(
        `This user is the responsible of site "${managed.name}" — name another responsible first`,
      );
    }
  }

  // A site administrator creates users in their own site without having to
  // name it. A platform administrator must say where the user goes — null
  // (a platform user) is never implied, since it makes every role global.
  private siteForNewUser(
    scope: SiteScopeList,
    requested: string | null | undefined,
  ): string | null {
    if (requested !== undefined) return requested;
    if (scope !== 'ALL' && scope.length === 1) return scope[0];
    throw new BadRequestException(
      'siteId is required (null for a platform user)',
    );
  }

  private async ensureExists(id: string) {
    const user = await this.database.user.findUnique({ where: { id } });
    if (!user) {
      throw new NotFoundException(`User ${id} not found`);
    }
    return user;
  }

  private async assertEmailAvailable(email: string) {
    const taken = await this.database.user.findUnique({
      where: { email },
      select: { id: true },
    });
    if (taken) {
      throw new ConflictException('Email is already in use');
    }
  }

  // `currentSiteId`: the user's site may be kept as-is even if it has since
  // been deactivated, but nobody is moved into an inactive site.
  private async assertReferencesExist(
    roleIds: string[] | undefined,
    siteId: string | null,
    currentSiteId: string | null = null,
  ) {
    if (roleIds?.length) {
      const found = await this.database.role.findMany({
        where: { id: { in: roleIds } },
        select: { id: true, name: true, siteId: true },
      });
      const missing = roleIds.filter((id) => !found.some((r) => r.id === id));
      if (missing.length) {
        throw new BadRequestException(
          `Unknown role ids: ${missing.join(', ')}`,
        );
      }
      // A user holds global roles, or roles of their own site.
      const elsewhere = found.filter(
        (role) => role.siteId !== null && role.siteId !== siteId,
      );
      if (elsewhere.length) {
        throw new BadRequestException(
          `Roles of another site: ${elsewhere.map((role) => role.name).join(', ')}`,
        );
      }
    }
    if (siteId) {
      const site = await this.database.site.findUnique({
        where: { id: siteId },
        select: { name: true, status: true },
      });
      if (!site) {
        throw new BadRequestException(`Unknown site id: ${siteId}`);
      }
      if (site.status !== SiteStatus.ACTIVE && siteId !== currentSiteId) {
        throw new BadRequestException(
          `Cannot assign users to inactive site: ${site.name}`,
        );
      }
    }
  }
}
