import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '../../../generated/prisma/client';
import { ActivityService } from '../../activity/activity.service';
import { AuditLog } from '../../activity/decorators/audit-log.decorator';
import { PermissionCode } from '../../auth/rbac/rbac.constants';
import {
  assertAdministers,
  assertInScope,
  RbacService,
  SiteScopeList,
} from '../../auth/rbac/rbac.service';
import { DatabaseService } from '../../database/database.service';
import { CreateEffetTypeDto } from './dto/create-effet-type.dto';
import { FindEffetTypesQueryDto } from './dto/find-effet-types.query.dto';
import { UpdateEffetTypeDto } from './dto/update-effet-type.dto';

const effetTypeInclude = {
  site: { select: { id: true, name: true } },
} satisfies Prisma.EffetTypeInclude;

/**
 * Global types (no site) are made by a platform administrator and usable on
 * every site; a site's responsible makes and manages the types of their own
 * site. Everyone sees the global types plus those of their own site — the
 * same rules as roles (see RoleService).
 */
@Injectable()
export class EffetTypeService {
  constructor(
    private readonly database: DatabaseService,
    private readonly rbac: RbacService,
    // Read by @AuditLog through `this.activity`.
    private readonly activity: ActivityService,
  ) {}

  @AuditLog({
    action: 'effet-type.created',
    entityType: 'effet-type',
    operation: 'CREATE',
  })
  async create(dto: CreateEffetTypeDto, actingUserId: string) {
    const scope = await this.adminScope(actingUserId);
    const { siteId: requestedSiteId, ...data } = dto;
    const siteId = this.siteForNewType(scope, requestedSiteId);
    assertInScope(scope, siteId);
    await this.assertNameAvailable(dto.name, siteId);
    return this.database.effetType.create({
      data: { ...data, siteId },
      include: effetTypeInclude,
    });
  }

  async findAll(query: FindEffetTypesQueryDto, actingUserId: string) {
    return this.database.effetType.findMany({
      where: {
        AND: [
          await this.visibleTo(actingUserId),
          // A site's types are its own and the common ones.
          query.siteId
            ? { OR: [{ siteId: null }, { siteId: query.siteId }] }
            : {},
          query.active === undefined ? {} : { active: query.active },
        ],
      },
      orderBy: { name: 'asc' },
      include: effetTypeInclude,
    });
  }

  async findOne(id: string, actingUserId: string) {
    const type = await this.database.effetType.findFirst({
      where: { id, AND: [await this.visibleTo(actingUserId)] },
      include: effetTypeInclude,
    });
    if (!type) {
      throw new NotFoundException(`Effet type ${id} not found`);
    }
    return type;
  }

  @AuditLog({
    action: 'effet-type.updated',
    entityType: 'effet-type',
    operation: 'UPDATE',
    findMethod: 'findById',
  })
  async update(id: string, dto: UpdateEffetTypeDto, actingUserId: string) {
    const scope = await this.adminScope(actingUserId);
    const existing = await this.findById(id);
    assertInScope(scope, existing.siteId);
    if (dto.name !== undefined && dto.name !== existing.name) {
      await this.assertNameAvailable(dto.name, existing.siteId);
    }
    return this.database.effetType.update({
      where: { id },
      data: dto,
      include: effetTypeInclude,
    });
  }

  // A type in use stays: effets keep their history. Deactivating it takes
  // it out of the choices instead.
  @AuditLog({
    action: 'effet-type.deleted',
    entityType: 'effet-type',
    operation: 'DELETE',
    findMethod: 'findById',
  })
  async remove(id: string, actingUserId: string) {
    const scope = await this.adminScope(actingUserId);
    const existing = await this.findById(id);
    assertInScope(scope, existing.siteId);
    const used = await this.database.courrier.count({ where: { typeId: id } });
    if (used > 0) {
      throw new ConflictException(
        `This type is used by ${used} effet(s) — deactivate it instead`,
      );
    }
    await this.database.effetType.delete({ where: { id } });
  }

  // No visibility scope: for @AuditLog's "before" snapshot and the
  // administration checks above, which apply their own scope.
  async findById(id: string) {
    const type = await this.database.effetType.findUnique({
      where: { id },
      include: effetTypeInclude,
    });
    if (!type) {
      throw new NotFoundException(`Effet type ${id} not found`);
    }
    return type;
  }

  // 'ALL' for a platform administrator, else the site they are the
  // responsible of; anyone else is refused.
  private async adminScope(actingUserId: string): Promise<SiteScopeList> {
    const scope = await this.rbac.managedSites(
      actingUserId,
      PermissionCode.AdminManageReferentials,
    );
    assertAdministers(scope);
    return scope;
  }

  // A site's responsible makes types for their site without naming it; a
  // platform administrator makes global types unless they name a site.
  private siteForNewType(
    scope: SiteScopeList,
    requested: string | undefined,
  ): string | null {
    if (requested !== undefined) return requested;
    if (scope === 'ALL') return null;
    if (scope.length === 1) return scope[0];
    throw new BadRequestException('siteId is required');
  }

  // Global types, plus the types of the caller's own site — everything for
  // a platform administrator.
  private async visibleTo(
    actingUserId: string,
  ): Promise<Prisma.EffetTypeWhereInput> {
    if (
      await this.rbac.hasGlobalPermission(
        actingUserId,
        PermissionCode.AdminManageReferentials,
      )
    ) {
      return {};
    }
    const user = await this.database.user.findUnique({
      where: { id: actingUserId },
      select: { siteId: true },
    });
    return {
      OR: [
        { siteId: null },
        ...(user?.siteId ? [{ siteId: user.siteId }] : []),
      ],
    };
  }

  private async assertNameAvailable(name: string, siteId: string | null) {
    const taken = await this.database.effetType.findFirst({
      where: { name, siteId },
      select: { id: true },
    });
    if (taken) {
      throw new ConflictException(
        `An effet type named "${name}" already exists`,
      );
    }
  }
}
