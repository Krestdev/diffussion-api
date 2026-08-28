import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '../../../generated/prisma/client';
import { createWithUniqueReference } from '../../common/utils/generate-reference';
import { DatabaseService } from '../../database/database.service';
import { CreateRoleDto } from './dto/create-role.dto';
import { UpdateRoleDto } from './dto/update-role.dto';

const roleInclude = {
  rolePermissions: { include: { permission: true } },
  _count: { select: { userRoles: true } },
} satisfies Prisma.RoleInclude;

function toView(role: Prisma.RoleGetPayload<{ include: typeof roleInclude }>) {
  const { rolePermissions, _count, ...rest } = role;
  return {
    ...rest,
    permissions: rolePermissions.map((rp) => rp.permission),
    usersCount: _count.userRoles,
  };
}

@Injectable()
export class RoleService {
  constructor(private readonly database: DatabaseService) {}

  async create(dto: CreateRoleDto) {
    const { permissionIds, ...data } = dto;
    const role = await createWithUniqueReference('RO', (code) =>
      this.database.role.create({
        data: {
          ...data,
          code,
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
    return toView(role);
  }

  async findAll() {
    const roles = await this.database.role.findMany({
      orderBy: { name: 'asc' },
      include: roleInclude,
    });
    return roles.map(toView);
  }

  async findOne(id: string) {
    const role = await this.database.role.findUnique({
      where: { id },
      include: roleInclude,
    });
    if (!role) {
      throw new NotFoundException(`Role ${id} not found`);
    }
    return toView(role);
  }

  async update(id: string, dto: UpdateRoleDto) {
    await this.ensureExists(id);
    const { permissionIds, ...data } = dto;

    const role = await this.database.role.update({
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
    });
    return toView(role);
  }

  async remove(id: string) {
    await this.ensureExists(id);
    try {
      await this.database.role.delete({ where: { id } });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2003'
      ) {
        throw new BadRequestException(
          'Role is still held by one or more users',
        );
      }
      throw error;
    }
  }

  private async ensureExists(id: string) {
    const role = await this.database.role.findUnique({ where: { id } });
    if (!role) {
      throw new NotFoundException(`Role ${id} not found`);
    }
    return role;
  }
}
