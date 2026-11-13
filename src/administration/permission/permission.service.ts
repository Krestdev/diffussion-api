import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '../../../generated/prisma/client';
import {
  PermissionCode,
  PLATFORM_PERMISSIONS,
} from '../../auth/rbac/rbac.constants';
import { assertAdministers, RbacService } from '../../auth/rbac/rbac.service';
import { DatabaseService } from '../../database/database.service';
import { CreatePermissionDto } from './dto/create-permission.dto';
import { UpdatePermissionDto } from './dto/update-permission.dto';

@Injectable()
export class PermissionService {
  constructor(
    private readonly database: DatabaseService,
    private readonly rbac: RbacService,
  ) {}

  create(dto: CreatePermissionDto) {
    return this.database.permission.create({ data: dto });
  }

  // What the caller may put in a role: the displayed permissions — all of
  // them for a platform administrator; a site's responsible doesn't get the
  // platform permissions, which a site role can't carry (see RoleService).
  async findAll(actingUserId: string) {
    return this.database.permission.findMany({
      where: { display: true, ...(await this.grantableBy(actingUserId)) },
      orderBy: { code: 'asc' },
    });
  }

  async findOne(id: string, actingUserId: string) {
    const permission = await this.database.permission.findFirst({
      where: { id, ...(await this.grantableBy(actingUserId)) },
    });
    if (!permission) {
      throw new NotFoundException(`Permission ${id} not found`);
    }
    return permission;
  }

  async update(id: string, dto: UpdatePermissionDto) {
    await this.ensureExists(id);
    return this.database.permission.update({ where: { id }, data: dto });
  }

  async remove(id: string) {
    await this.ensureExists(id);
    try {
      await this.database.permission.delete({ where: { id } });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2003'
      ) {
        throw new BadRequestException(
          'Permission is still granted to one or more roles',
        );
      }
      throw error;
    }
  }

  // update/remove are platform-only routes: no scope to apply.
  private async ensureExists(id: string) {
    const permission = await this.database.permission.findUnique({
      where: { id },
      select: { id: true },
    });
    if (!permission) {
      throw new NotFoundException(`Permission ${id} not found`);
    }
  }

  private async grantableBy(
    actingUserId: string,
  ): Promise<Prisma.PermissionWhereInput> {
    const scope = await this.rbac.managedSites(
      actingUserId,
      PermissionCode.AdminManageRoles,
    );
    assertAdministers(scope);
    return scope === 'ALL'
      ? {}
      : { code: { notIn: [...PLATFORM_PERMISSIONS] } };
  }
}
