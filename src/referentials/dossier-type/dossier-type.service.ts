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
import {
  CreateSiteListItemDto,
  FindSiteListQueryDto,
  UpdateSiteListItemDto,
} from '../../common/dto/site-list-item.dto';
import {
  assertSiteExists,
  siteReferentialsWhere,
} from '../../common/utils/site-referentials';
import { DEFAULT_TAKE } from '../../common/dto/pagination.query.dto';
import { DatabaseService } from '../../database/database.service';

const include = {
  site: { select: { id: true, code: true, name: true } },
  _count: { select: { dossiers: true } },
} satisfies Prisma.DossierTypeInclude;

/**
 * Kinds of dossier (PA·7) — each site's own: managed by its responsible or
 * whoever holds ADMIN_MANAGE_REFERENTIALS there. Deactivated rather than
 * deleted once used.
 */
@Injectable()
export class DossierTypeService {
  constructor(
    private readonly database: DatabaseService,
    private readonly rbac: RbacService,
    // Read by @AuditLog through `this.activity`.
    private readonly activity: ActivityService,
  ) {}

  @AuditLog({
    action: 'dossier-type.created',
    entityType: 'dossier-type',
    operation: 'CREATE',
  })
  async create(dto: CreateSiteListItemDto, actingUserId: string) {
    const scope = await this.rbac.managedSites(
      actingUserId,
      PermissionCode.AdminManageReferentials,
    );
    const siteId = siteForNew(scope, dto.siteId);
    await this.rbac.explainOutOfScope(
      scope,
      siteId,
      'Ce type de dossier',
      PermissionCode.AdminManageReferentials,
    );
    await assertSiteExists(this.database, siteId);
    await this.assertNameAvailable(dto.name, siteId);
    return this.database.dossierType.create({
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
      this.database.dossierType.findMany({
        where,
        orderBy: { name: 'asc' },
        include,
        skip,
        take,
      }),
      this.database.dossierType.count({ where }),
    ]);
    return { data, total, skip, take };
  }

  async findOne(id: string) {
    const type = await this.database.dossierType.findUnique({
      where: { id },
      include,
    });
    if (!type) throw new NotFoundException(`Dossier type ${id} not found`);
    return type;
  }

  @AuditLog({
    action: 'dossier-type.updated',
    entityType: 'dossier-type',
    operation: 'UPDATE',
  })
  async update(id: string, dto: UpdateSiteListItemDto, actingUserId: string) {
    const type = await this.findOne(id);
    await this.assertManages(type.siteId, actingUserId);
    if (dto.name !== undefined && dto.name !== type.name) {
      await this.assertNameAvailable(dto.name, type.siteId);
    }
    return this.database.dossierType.update({
      where: { id },
      data: dto,
      include,
    });
  }

  @AuditLog({
    action: 'dossier-type.deleted',
    entityType: 'dossier-type',
    operation: 'DELETE',
  })
  async remove(id: string, actingUserId: string) {
    const type = await this.findOne(id);
    await this.assertManages(type.siteId, actingUserId);
    if (type._count.dossiers > 0) {
      throw new ConflictException(
        `This type is used by ${type._count.dossiers} dossier(s) — deactivate it instead`,
      );
    }
    await this.database.dossierType.delete({ where: { id } });
  }

  private assertManages(siteId: string, userId: string) {
    return this.rbac.assertManagesSite(
      userId,
      PermissionCode.AdminManageReferentials,
      siteId,
      'Ce type de dossier',
    );
  }

  private async assertNameAvailable(name: string, siteId: string) {
    const taken = await this.database.dossierType.findFirst({
      where: { name, siteId },
      select: { id: true },
    });
    if (taken) {
      throw new ConflictException(
        `A dossier type "${name}" already exists on this site`,
      );
    }
  }
}

function siteForNew(scope: SiteScopeList, requested?: string): string {
  if (requested) return requested;
  if (scope !== 'ALL' && scope.length === 1) return scope[0];
  throw new BadRequestException('siteId is required');
}

/** A dossier's kind: an active type of the dossier's own site. */
export async function assertDossierTypeUsable(
  db: DatabaseService,
  typeId: string,
  siteId: string,
) {
  const type = await db.dossierType.findUnique({
    where: { id: typeId },
    select: { name: true, siteId: true, active: true },
  });
  if (!type) throw new BadRequestException(`Dossier type ${typeId} not found`);
  if (type.siteId !== siteId) {
    throw new BadRequestException(
      `The dossier type « ${type.name} » belongs to another site`,
    );
  }
  if (!type.active) {
    throw new BadRequestException(
      `The dossier type « ${type.name} » is inactive and can no longer be chosen`,
    );
  }
}
