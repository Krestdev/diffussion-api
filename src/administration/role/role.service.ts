import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '../../../generated/prisma/client';
import { RbacService } from '../../auth/rbac/rbac.service';
import {
  DEFAULT_TAKE,
  PaginationQueryDto,
} from '../../common/dto/pagination.query.dto';
import { createWithUniqueReference } from '../../common/utils/generate-reference';
import { DatabaseService } from '../../database/database.service';
import { CreateRoleDto } from './dto/create-role.dto';
import { UpdateRoleDto } from './dto/update-role.dto';

const roleInclude = {
  rolePermissions: { include: { permission: true } },
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

@Injectable()
export class RoleService {
  constructor(
    private readonly database: DatabaseService,
    private readonly rbac: RbacService,
  ) {}

  async create(dto: CreateRoleDto) {
    // Checked up front: createWithUniqueReference retries on *any* unique
    // violation, so a duplicate name would otherwise burn every retry on
    // fresh codes and surface as a 500.
    await this.assertNameAvailable(dto.name);
    await this.assertPermissionsExist(dto.permissionIds);
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

  async findAll(query: PaginationQueryDto) {
    const skip = query.skip ?? 0;
    const take = query.take ?? DEFAULT_TAKE;
    const where: Prisma.RoleWhereInput = query.search
      ? {
          OR: [
            { name: { contains: query.search, mode: 'insensitive' } },
            { code: { contains: query.search, mode: 'insensitive' } },
          ],
        }
      : {};
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
    const existing = await this.ensureExists(id);
    if (dto.name !== undefined && dto.name !== existing.name) {
      await this.assertNameAvailable(dto.name);
    }
    await this.assertPermissionsExist(dto.permissionIds);
    const { permissionIds, ...data } = dto;

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
    return toView(role);
  }

  // A role's permission grid is owned by the role and goes with it; users
  // holding it or circuits/steps requiring it block the deletion (removing
  // it would silently strip rights or leave a workflow step with nobody
  // eligible to act).
  async remove(id: string) {
    await this.ensureExists(id);
    const [usersCount, circuits, steps] = await Promise.all([
      this.database.userRole
        .findMany({
          where: { roleId: id },
          select: { userId: true },
          distinct: ['userId'],
        })
        .then((holders) => holders.length),
      this.database.circuit.findMany({
        where: { roleId: id },
        select: { name: true },
      }),
      this.database.circuitStep.findMany({
        where: { roleId: id },
        select: { order: true, circuit: { select: { name: true } } },
      }),
    ]);
    if (usersCount > 0) {
      throw new ConflictException(
        `Role is still held by ${usersCount} user(s) — remove it from them first`,
      );
    }
    if (circuits.length > 0 || steps.length > 0) {
      const usages = [
        ...circuits.map((c) => `circuit "${c.name}"`),
        ...steps.map((s) => `step ${s.order} of circuit "${s.circuit.name}"`),
      ];
      throw new ConflictException(
        `Role is required by ${usages.join(', ')} — reassign those first`,
      );
    }

    await this.database.$transaction([
      this.database.rolePermission.deleteMany({ where: { roleId: id } }),
      this.database.role.delete({ where: { id } }),
    ]);
  }

  private async ensureExists(id: string) {
    const role = await this.database.role.findUnique({ where: { id } });
    if (!role) {
      throw new NotFoundException(`Role ${id} not found`);
    }
    return role;
  }

  private async assertNameAvailable(name: string) {
    const taken = await this.database.role.findUnique({
      where: { name },
      select: { id: true },
    });
    if (taken) {
      throw new ConflictException(`A role named "${name}" already exists`);
    }
  }

  private async assertPermissionsExist(permissionIds?: string[]) {
    if (!permissionIds?.length) return;
    const found = await this.database.permission.findMany({
      where: { id: { in: permissionIds } },
      select: { id: true },
    });
    const missing = permissionIds.filter(
      (id) => !found.some((p) => p.id === id),
    );
    if (missing.length) {
      throw new BadRequestException(
        `Unknown permission ids: ${missing.join(', ')}`,
      );
    }
  }
}
