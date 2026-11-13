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
import { RbacService, SiteScopeList } from '../../auth/rbac/rbac.service';
import { FindSiteListQueryDto } from '../../common/dto/site-list-item.dto';
import {
  assertSiteExists,
  siteReferentialsWhere,
} from '../../common/utils/site-referentials';
import { DEFAULT_TAKE } from '../../common/dto/pagination.query.dto';
import { DatabaseService } from '../../database/database.service';
import { CreateCorrespondentTypeDto } from './dto/create-correspondent-type.dto';
import { UpdateCorrespondentTypeDto } from './dto/update-correspondent-type.dto';

const include = {
  site: { select: { id: true, code: true, name: true } },
  _count: { select: { correspondents: true } },
} satisfies Prisma.CorrespondentTypeInclude;

/**
 * Kinds of correspondent (PA·7) — each site's own, like its canaux: managed
 * by its responsible or whoever holds ADMIN_MANAGE_REFERENTIALS there.
 * Deactivated rather than deleted once used.
 */
@Injectable()
export class CorrespondentTypeService {
  constructor(
    private readonly database: DatabaseService,
    private readonly rbac: RbacService,
    // Read by @AuditLog through `this.activity`.
    private readonly activity: ActivityService,
  ) {}

  @AuditLog({
    action: 'correspondent-type.created',
    entityType: 'correspondent-type',
    operation: 'CREATE',
  })
  async create(dto: CreateCorrespondentTypeDto, actingUserId: string) {
    const scope = await this.manageScope(actingUserId);
    const siteId = siteForNew(scope, dto.siteId);
    await this.rbac.explainOutOfScope(
      scope,
      siteId,
      'Ce type de correspondant',
      PermissionCode.AdminManageReferentials,
    );
    await assertSiteExists(this.database, siteId);
    await this.assertNameAvailable(dto.name, siteId);
    return this.database.correspondentType.create({
      data: { ...dto, siteId },
      include,
    });
  }

  // Paginated like every list: { data, total, skip, take }.
  async findAll(query: FindSiteListQueryDto, actingUserId: string) {
    const where = {
      ...(await siteReferentialsWhere(
        this.rbac,
        this.database,
        actingUserId,
        query.siteId,
      )),
      active: query.active,
      ...(query.search
        ? { name: { contains: query.search, mode: 'insensitive' as const } }
        : {}),
    };
    const skip = query.skip ?? 0;
    const take = query.take ?? DEFAULT_TAKE;
    const [data, total] = await this.database.$transaction([
      this.database.correspondentType.findMany({
        where,
        orderBy: { name: 'asc' },
        include,
        skip,
        take,
      }),
      this.database.correspondentType.count({ where }),
    ]);
    return { data, total, skip, take };
  }

  async findOne(id: string) {
    const type = await this.database.correspondentType.findUnique({
      where: { id },
      include,
    });
    if (!type) {
      throw new NotFoundException(`Correspondent type ${id} not found`);
    }
    return type;
  }

  @AuditLog({
    action: 'correspondent-type.updated',
    entityType: 'correspondent-type',
    operation: 'UPDATE',
  })
  async update(
    id: string,
    dto: UpdateCorrespondentTypeDto,
    actingUserId: string,
  ) {
    const type = await this.findOne(id);
    await this.assertManages(type.siteId, actingUserId);
    if (dto.name !== undefined && dto.name !== type.name) {
      await this.assertNameAvailable(dto.name, type.siteId);
    }
    return this.database.correspondentType.update({
      where: { id },
      data: dto,
      include,
    });
  }

  // Only an unused type goes; a used one is deactivated instead.
  @AuditLog({
    action: 'correspondent-type.deleted',
    entityType: 'correspondent-type',
    operation: 'DELETE',
  })
  async remove(id: string, actingUserId: string) {
    const type = await this.findOne(id);
    await this.assertManages(type.siteId, actingUserId);
    if (type._count.correspondents > 0) {
      throw new ConflictException(
        `This type is used by ${type._count.correspondents} correspondent(s) — deactivate it instead`,
      );
    }
    await this.database.correspondentType.delete({ where: { id } });
  }

  private async manageScope(userId: string): Promise<SiteScopeList> {
    return this.rbac.managedSites(
      userId,
      PermissionCode.AdminManageReferentials,
    );
  }

  private async assertManages(siteId: string, userId: string) {
    await this.rbac.assertManagesSite(
      userId,
      PermissionCode.AdminManageReferentials,
      siteId,
      'Ce type de correspondant',
    );
  }

  private async assertNameAvailable(name: string, siteId: string) {
    const taken = await this.database.correspondentType.findFirst({
      where: { name, siteId },
      select: { id: true },
    });
    if (taken) {
      throw new ConflictException(
        `A correspondent type "${name}" already exists on this site`,
      );
    }
  }
}

function siteForNew(scope: SiteScopeList, requested?: string): string {
  if (requested) return requested;
  if (scope !== 'ALL' && scope.length === 1) return scope[0];
  throw new BadRequestException('siteId is required');
}
