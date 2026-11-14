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
import { FindCompanyListQueryDto } from '../../common/dto/company-list-item.dto';
import {
  assertCompanyExists,
  companyReferentialsWhere,
} from '../../common/utils/company-referentials';
import { DEFAULT_TAKE } from '../../common/dto/pagination.query.dto';
import { DatabaseService } from '../../database/database.service';
import { CreateCorrespondentTypeDto } from './dto/create-correspondent-type.dto';
import { UpdateCorrespondentTypeDto } from './dto/update-correspondent-type.dto';

const include = {
  company: { select: { id: true, code: true, name: true } },
  _count: { select: { correspondents: true } },
} satisfies Prisma.CorrespondentTypeInclude;

/**
 * Kinds of correspondent (PA·7) — each company's own, like its canaux: managed
 * by whoever holds settings.update there.
 * Deactivated rather than deleted once used.
 */
@Injectable()
export class CorrespondentTypeService {
  constructor(
    private readonly database: DatabaseService,
    private readonly access: AccessService,
    // Read by @AuditLog through `this.activity`.
    private readonly activity: ActivityService,
  ) {}

  @AuditLog({
    action: 'correspondent-type.created',
    entityType: 'correspondent-type',
    operation: 'CREATE',
  })
  async create(dto: CreateCorrespondentTypeDto, actingUserId: string) {
    const companyId =
      dto.companyId ?? (await this.access.companyOf(actingUserId));
    if (!companyId) throw new BadRequestException('companyId is required');
    await this.assertManages(companyId, actingUserId);
    await assertCompanyExists(this.database, companyId);
    await this.assertNameAvailable(dto.name, companyId);
    return this.database.correspondentType.create({
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
    await this.assertManages(type.companyId, actingUserId);
    if (dto.name !== undefined && dto.name !== type.name) {
      await this.assertNameAvailable(dto.name, type.companyId);
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
    await this.assertManages(type.companyId, actingUserId);
    if (type._count.correspondents > 0) {
      throw new ConflictException(
        `This type is used by ${type._count.correspondents} correspondent(s) — deactivate it instead`,
      );
    }
    await this.database.correspondentType.delete({ where: { id } });
  }

  private async assertManages(companyId: string, userId: string) {
    await this.access.assertManages(
      userId,
      Permission.SETTINGS_UPDATE,
      companyId,
      'Ce type de correspondant',
    );
  }

  private async assertNameAvailable(name: string, companyId: string) {
    const taken = await this.database.correspondentType.findFirst({
      where: { name, companyId },
      select: { id: true },
    });
    if (taken) {
      throw new ConflictException(
        `A correspondent type "${name}" already exists on this company`,
      );
    }
  }
}
