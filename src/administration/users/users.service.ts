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
import { RbacService } from '../../auth/rbac/rbac.service';
import { DEFAULT_TAKE } from '../../common/dto/pagination.query.dto';
import { DatabaseService } from '../../database/database.service';
import { CreateUserDto } from './dto/create-user.dto';
import { FindUsersQueryDto } from './dto/find-users.query.dto';
import { UpdateUserDto } from './dto/update-user.dto';

const SALT_ROUNDS = 10;

const userInclude = {
  userRoles: { include: { role: true } },
  assignments: { include: { site: true } },
} satisfies Prisma.UserInclude;

function toView(user: Prisma.UserGetPayload<{ include: typeof userInclude }>) {
  // password/refreshToken destructured solely to exclude them from `rest`
  // before it goes out over the API.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { userRoles, assignments, password, refreshToken, ...rest } = user;
  return {
    ...rest,
    roles: userRoles.map((ur) => ur.role),
    sites: assignments.map((a) => a.site),
  };
}

@Injectable()
export class UsersService {
  constructor(
    private readonly database: DatabaseService,
    private readonly rbac: RbacService,
  ) {}

  async create(dto: CreateUserDto) {
    await this.assertEmailAvailable(dto.email);
    await this.assertReferencesExist(dto.roleIds, dto.siteIds);

    const { roleIds, siteIds, password, ...data } = dto;
    const hashedPassword = await bcrypt.hash(password, SALT_ROUNDS);

    const user = await this.database.user.create({
      data: {
        ...data,
        password: hashedPassword,
        status: UserStatus.ACTIVE,
        userRoles: roleIds
          ? { create: roleIds.map((roleId) => ({ roleId })) }
          : undefined,
        assignments: siteIds
          ? { create: siteIds.map((siteId) => ({ siteId })) }
          : undefined,
      },
      include: userInclude,
    });
    return toView(user);
  }

  async findAll(query: FindUsersQueryDto) {
    const skip = query.skip ?? 0;
    const take = query.take ?? DEFAULT_TAKE;
    const where: Prisma.UserWhereInput = {
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

  async findOne(id: string) {
    const user = await this.database.user.findUnique({
      where: { id },
      include: userInclude,
    });
    if (!user) {
      throw new NotFoundException(`User ${id} not found`);
    }
    return toView(user);
  }

  async update(id: string, dto: UpdateUserDto) {
    const existing = await this.ensureExists(id);
    if (dto.email !== undefined && dto.email !== existing.email) {
      await this.assertEmailAvailable(dto.email);
    }
    const currentSiteIds = (
      await this.database.assignment.findMany({
        where: { userId: id },
        select: { siteId: true },
      })
    ).map((a) => a.siteId);
    await this.assertReferencesExist(dto.roleIds, dto.siteIds, currentSiteIds);
    const { roleIds, siteIds, password, ...data } = dto;
    const hashedPassword = password
      ? await bcrypt.hash(password, SALT_ROUNDS)
      : undefined;

    // Guarded: replacing the role set may strip the last admin's rights.
    const user = await this.rbac.withAdminCoverage((tx) =>
      tx.user.update({
        where: { id },
        data: {
          ...data,
          password: hashedPassword,
          // A password reset ends every existing session: the refresh
          // token can no longer be exchanged, so the user must log in
          // again with the new password once their access token expires.
          refreshToken: hashedPassword ? null : undefined,
          // Replace-set semantics, matching the "Rôle" chip picker on the
          // frontend which always sends the desired full list.
          userRoles:
            roleIds !== undefined
              ? {
                  deleteMany: {},
                  create: roleIds.map((roleId) => ({ roleId })),
                }
              : undefined,
          assignments:
            siteIds !== undefined
              ? {
                  deleteMany: {},
                  create: siteIds.map((siteId) => ({ siteId })),
                }
              : undefined,
        },
        include: userInclude,
      }),
    );
    return toView(user);
  }

  async toggleStatus(id: string, actingUserId: string) {
    const user = await this.ensureExists(id);
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
    return toView(updated);
  }

  // Membership rows (roles, sites, services, notification inbox) go with
  // the user; anything that is business history (dossiers, courriers,
  // validations, delegations...) blocks the deletion — suspend instead.
  async remove(id: string, actingUserId: string) {
    await this.ensureExists(id);
    if (id === actingUserId) {
      throw new BadRequestException('You cannot delete your own account');
    }

    try {
      await this.rbac.withAdminCoverage(async (tx) => {
        await tx.userRole.deleteMany({ where: { userId: id } });
        await tx.assignment.deleteMany({ where: { userId: id } });
        await tx.userService.deleteMany({ where: { userId: id } });
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

  // `currentSiteIds`: sites the user is already assigned to — they may be
  // resent as-is even if they've since been deactivated (replace-set
  // picker), but no *new* assignment to an inactive site is allowed.
  private async assertReferencesExist(
    roleIds?: string[],
    siteIds?: string[],
    currentSiteIds: string[] = [],
  ) {
    if (roleIds?.length) {
      const found = await this.database.role.findMany({
        where: { id: { in: roleIds } },
        select: { id: true },
      });
      const missing = roleIds.filter((id) => !found.some((r) => r.id === id));
      if (missing.length) {
        throw new BadRequestException(
          `Unknown role ids: ${missing.join(', ')}`,
        );
      }
    }
    if (siteIds?.length) {
      const found = await this.database.site.findMany({
        where: { id: { in: siteIds } },
        select: { id: true, name: true, status: true },
      });
      const missing = siteIds.filter((id) => !found.some((s) => s.id === id));
      if (missing.length) {
        throw new BadRequestException(
          `Unknown site ids: ${missing.join(', ')}`,
        );
      }
      const newlyInactive = found.filter(
        (site) =>
          site.status !== SiteStatus.ACTIVE &&
          !currentSiteIds.includes(site.id),
      );
      if (newlyInactive.length) {
        throw new BadRequestException(
          `Cannot assign users to inactive site(s): ${newlyInactive.map((site) => site.name).join(', ')}`,
        );
      }
    }
  }
}
