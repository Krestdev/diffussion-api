import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { createHash, randomBytes } from 'crypto';
import {
  AccessProfile,
  Prisma,
  SiteStatus,
  UserStatus,
} from '../../../generated/prisma/client';
import { MailerService } from '../../mail/mailer.service';
import {
  AcceptInvitationDto,
  CreateInvitationDto,
  FindInvitationsQueryDto,
} from './dto/invitation.dto';
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
import { FindDirectoryQueryDto } from './dto/find-directory.query.dto';
import { FindUsersQueryDto } from './dto/find-users.query.dto';
import { UpdateUserDto } from './dto/update-user.dto';

const SALT_ROUNDS = 10;
// An invitation link is valid this long.
const INVITATION_TTL_DAYS = 7;

const userInclude = {
  userRoles: { include: { role: true } },
  site: true,
  deactivatedBy: { select: { id: true, name: true } },
} satisfies Prisma.UserInclude;

const invitationSelect = {
  id: true,
  email: true,
  name: true,
  sentAt: true,
  expiresAt: true,
  site: { select: { id: true, name: true } },
  role: { select: { id: true, name: true } },
  invitedBy: { select: { id: true, name: true } },
} satisfies Prisma.InvitationSelect;

function hashToken(token: string) {
  return createHash('sha256').update(token).digest('hex');
}

// Neither accepted nor revoked, and not expired.
function pendingInvitation(now = new Date()): Prisma.InvitationWhereInput {
  return { acceptedAt: null, revokedAt: null, expiresAt: { gt: now } };
}

function appBaseUrl() {
  // CORS_ORIGINS may be "*" (any origin) — not a usable link base.
  const firstCorsOrigin = process.env.CORS_ORIGINS?.split(',')[0]?.trim();
  return (
    process.env.APP_WEB_URL ??
    (firstCorsOrigin && firstCorsOrigin !== '*'
      ? firstCorsOrigin
      : undefined) ??
    'http://localhost:4000'
  ).replace(/\/$/, '');
}

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
    private readonly mailer: MailerService,
  ) {}

  async create(dto: CreateUserDto, actingUserId: string) {
    const scope = await this.adminScope(actingUserId);
    const { roleIds = [], siteId: requestedSiteId, password, ...data } = dto;
    const siteId = this.siteForNewUser(scope, requestedSiteId);
    assertInScope(scope, siteId);
    this.assertProfileAllowed(scope, dto.accessProfile);
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
    // A suspended responsible can't log in: their site would be left with
    // nobody to administer it and nobody to validate its effets.
    if (suspending) {
      await this.assertNotResponsible(id);
    }

    const updated = await this.rbac.withAdminCoverage((tx) =>
      tx.user.update({
        where: { id },
        data: suspending
          ? {
              status: UserStatus.SUSPENDED,
              refreshToken: null,
              isConnected: false,
              deactivatedAt: new Date(),
              deactivatedById: actingUserId,
            }
          : {
              status: UserStatus.ACTIVE,
              deactivatedAt: null,
              deactivatedById: null,
            },
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

  // ------------------------------------------------------------ invitations

  /**
   * Invites someone (A·12): the link reaches them by email, and accepting
   * it with a password creates their account, at `siteId` with `roleId`.
   */
  async invite(dto: CreateInvitationDto, actingUserId: string) {
    const scope = await this.adminScope(actingUserId);
    const siteId = this.siteForNewUser(scope, dto.siteId);
    assertInScope(scope, siteId);
    await this.assertEmailAvailable(dto.email);
    await this.assertReferencesExist(
      dto.roleId ? [dto.roleId] : undefined,
      siteId,
    );
    const pending = await this.database.invitation.findFirst({
      where: { email: dto.email, ...pendingInvitation() },
      select: { id: true },
    });
    if (pending) {
      throw new ConflictException(
        'An invitation is already pending for this email — revoke it first',
      );
    }

    const token = randomBytes(32).toString('hex');
    const expiresAt = new Date(
      Date.now() + INVITATION_TTL_DAYS * 24 * 60 * 60 * 1000,
    );
    const invitation = await this.database.invitation.create({
      data: {
        email: dto.email,
        name: dto.name,
        siteId,
        roleId: dto.roleId ?? null,
        invitedById: actingUserId,
        tokenHash: hashToken(token),
        expiresAt,
      },
      select: invitationSelect,
    });
    await this.mailer.sendInvitation({
      to: invitation.email,
      name: invitation.name,
      invitedBy: invitation.invitedBy?.name ?? null,
      acceptLink: `${appBaseUrl()}/invitation?token=${token}`,
      expiresAt,
    });
    return invitation;
  }

  // The pending invitations the caller administers, latest first.
  async findInvitations(query: FindInvitationsQueryDto, actingUserId: string) {
    const scope = await this.adminScope(actingUserId);
    return this.database.invitation.findMany({
      where: {
        ...pendingInvitation(),
        AND: [
          scope === 'ALL' ? {} : { siteId: { in: scope } },
          query.siteId ? { siteId: query.siteId } : {},
        ],
      },
      select: invitationSelect,
      orderBy: { sentAt: 'desc' },
    });
  }

  // The link stops working; the invitation leaves the pending list.
  async revokeInvitation(id: string, actingUserId: string) {
    const scope = await this.adminScope(actingUserId);
    const invitation = await this.database.invitation.findUnique({
      where: { id },
      select: { siteId: true },
    });
    if (!invitation) {
      throw new NotFoundException(`Invitation ${id} not found`);
    }
    assertInScope(scope, invitation.siteId);
    const { count } = await this.database.invitation.updateMany({
      where: { id, ...pendingInvitation() },
      data: { revokedAt: new Date() },
    });
    if (count === 0) {
      throw new BadRequestException('This invitation is no longer pending');
    }
  }

  // What the invitee sees before accepting: who invited them, to what.
  async invitationByToken(token: string) {
    const invitation = await this.database.invitation.findFirst({
      where: { tokenHash: hashToken(token ?? ''), ...pendingInvitation() },
      select: invitationSelect,
    });
    if (!invitation) {
      throw new BadRequestException(
        'This invitation link is invalid or has expired',
      );
    }
    return invitation;
  }

  // Creates the account, with the role it was invited to, once.
  async acceptInvitation(dto: AcceptInvitationDto) {
    const invitation = await this.database.invitation.findFirst({
      where: { tokenHash: hashToken(dto.token), ...pendingInvitation() },
      include: { role: { select: { archivedAt: true } } },
    });
    if (!invitation) {
      throw new BadRequestException(
        'This invitation link is invalid or has expired',
      );
    }
    await this.assertEmailAvailable(invitation.email);
    const roleId =
      invitation.roleId && !invitation.role?.archivedAt
        ? invitation.roleId
        : null;
    const password = await bcrypt.hash(dto.password, SALT_ROUNDS);
    const user = await this.database.$transaction(async (tx) => {
      const created = await tx.user.create({
        data: {
          name: invitation.name,
          email: invitation.email,
          password,
          siteId: invitation.siteId,
          status: UserStatus.ACTIVE,
          isVerified: true,
          userRoles: roleId
            ? { create: grantsAt([roleId], invitation.siteId) }
            : undefined,
        },
        select: { id: true, name: true, email: true },
      });
      const { count } = await tx.invitation.updateMany({
        where: { id: invitation.id, acceptedAt: null, revokedAt: null },
        data: { acceptedAt: new Date(), userId: created.id },
      });
      if (count === 0) {
        throw new ConflictException('This invitation was used meanwhile');
      }
      return created;
    });
    this.realtime.broadcast('user:new', { id: user.id });
    return user;
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

  // A site's responsible belongs to it and administers it (SiteService):
  // moving them away or suspending them would leave the site without its
  // administrator. Name another responsible first.
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
        select: { id: true, name: true, siteId: true, archivedAt: true },
      });
      const missing = roleIds.filter((id) => !found.some((r) => r.id === id));
      if (missing.length) {
        throw new BadRequestException(
          `Unknown role ids: ${missing.join(', ')}`,
        );
      }
      const archived = found.filter((role) => role.archivedAt);
      if (archived.length) {
        throw new BadRequestException(
          `Archived roles cannot be granted: ${archived.map((role) => role.name).join(', ')}`,
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
