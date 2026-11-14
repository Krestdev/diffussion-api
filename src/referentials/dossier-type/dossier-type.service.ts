import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '../../../generated/prisma/client';
import { ActivityService } from '../../activity/activity.service';
import { AuditLog } from '../../activity/decorators/audit-log.decorator';
import { Permission } from '../../auth/permissions';
import { AccessService } from '../../auth/access/access.service';
import {
  CreateCompanyListItemDto,
  FindCompanyListQueryDto,
  UpdateCompanyListItemDto,
} from '../../common/dto/company-list-item.dto';
import {
  assertCompanyExists,
  companyReferentialsWhere,
} from '../../common/utils/company-referentials';
import { DEFAULT_TAKE } from '../../common/dto/pagination.query.dto';
import { DatabaseService } from '../../database/database.service';

const include = {
  company: { select: { id: true, code: true, name: true } },
  _count: { select: { dossiers: true } },
} satisfies Prisma.DossierTypeInclude;

/**
 * Kinds of dossier (PA·7) — each company's own: managed by whoever holds
 * settings.update there. Deactivated rather than
 * deleted once used.
 */
@Injectable()
export class DossierTypeService {
  constructor(
    private readonly database: DatabaseService,
    private readonly access: AccessService,
    // Read by @AuditLog through `this.activity`.
    private readonly activity: ActivityService,
  ) {}

  @AuditLog({
    action: 'dossier-type.created',
    entityType: 'dossier-type',
    operation: 'CREATE',
  })
  async create(dto: CreateCompanyListItemDto, actingUserId: string) {
    const companyId =
      dto.companyId ?? (await this.access.companyOf(actingUserId));
    if (!companyId) throw new BadRequestException('companyId is required');
    await this.access.assertManages(
      actingUserId,
      Permission.SETTINGS_UPDATE,
      companyId,
      'Ce type de dossier',
    );
    await assertCompanyExists(this.database, companyId);
    await this.assertNameAvailable(dto.name, companyId);
    return this.database.dossierType.create({
      data: { ...dto, companyId },
      include,
    });
  }

  // Paginated like every list: { data, total, skip, take }.
  async findAll(query: FindCompanyListQueryDto, actingUserId: string) {
    const where = {
      ...(await companyReferentialsWhere(
        this.access,
        this.database,
        actingUserId,
        query.companyId,
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
  async update(
    id: string,
    dto: UpdateCompanyListItemDto,
    actingUserId: string,
  ) {
    const type = await this.findOne(id);
    await this.assertManages(type.companyId, actingUserId);
    if (dto.name !== undefined && dto.name !== type.name) {
      await this.assertNameAvailable(dto.name, type.companyId);
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
    await this.assertManages(type.companyId, actingUserId);
    if (type._count.dossiers > 0) {
      throw new ConflictException(
        `This type is used by ${type._count.dossiers} dossier(s) — deactivate it instead`,
      );
    }
    await this.database.dossierType.delete({ where: { id } });
  }

  private assertManages(companyId: string, userId: string) {
    return this.access.assertManages(
      userId,
      Permission.SETTINGS_UPDATE,
      companyId,
      'Ce type de dossier',
    );
  }

  private async assertNameAvailable(name: string, companyId: string) {
    const taken = await this.database.dossierType.findFirst({
      where: { name, companyId },
      select: { id: true },
    });
    if (taken) {
      throw new ConflictException(
        `A dossier type "${name}" already exists on this company`,
      );
    }
  }
}

/** A dossier's kind: an active type of the dossier's own company. */
export async function assertDossierTypeUsable(
  db: DatabaseService,
  typeId: string,
  companyId: string,
) {
  const type = await db.dossierType.findUnique({
    where: { id: typeId },
    select: { name: true, companyId: true, active: true },
  });
  if (!type) throw new BadRequestException(`Dossier type ${typeId} not found`);
  if (type.companyId !== companyId) {
    throw new BadRequestException(
      `The dossier type « ${type.name} » belongs to another company`,
    );
  }
  if (!type.active) {
    throw new BadRequestException(
      `The dossier type « ${type.name} » is inactive and can no longer be chosen`,
    );
  }
}
