import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { Prisma, UserStatus } from '../../../generated/prisma/client';
import { DatabaseService } from '../../database/database.service';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';

const SALT_ROUNDS = 10;

const userInclude = {
  userRoles: { include: { role: true } },
  assignments: { include: { site: true } },
} satisfies Prisma.UserInclude;

function toView(user: Prisma.UserGetPayload<{ include: typeof userInclude }>) {
  const { userRoles, assignments, password, refreshToken, ...rest } = user;
  return {
    ...rest,
    roles: userRoles.map((ur) => ur.role),
    sites: assignments.map((a) => a.site),
  };
}

@Injectable()
export class UsersService {
  constructor(private readonly database: DatabaseService) {}

  async create(dto: CreateUserDto) {
    const existing = await this.database.user.findUnique({
      where: { email: dto.email },
    });
    if (existing) {
      throw new ConflictException('Email is already in use');
    }

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

  async findAll() {
    const users = await this.database.user.findMany({
      orderBy: { createdAt: 'desc' },
      include: userInclude,
    });
    return users.map(toView);
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
    await this.ensureExists(id);
    const { roleIds, siteIds, password, ...data } = dto;

    const user = await this.database.user.update({
      where: { id },
      data: {
        ...data,
        password: password ? await bcrypt.hash(password, SALT_ROUNDS) : undefined,
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
    });
    return toView(user);
  }

  async toggleStatus(id: string) {
    const user = await this.ensureExists(id);
    const updated = await this.database.user.update({
      where: { id },
      data: {
        status:
          user.status === UserStatus.ACTIVE
            ? UserStatus.SUSPENDED
            : UserStatus.ACTIVE,
      },
      include: userInclude,
    });
    return toView(updated);
  }

  async remove(id: string) {
    await this.ensureExists(id);
    try {
      await this.database.user.delete({ where: { id } });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2003'
      ) {
        throw new BadRequestException(
          'User is still referenced elsewhere (dossiers, instructions, audit trail...)',
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
}
