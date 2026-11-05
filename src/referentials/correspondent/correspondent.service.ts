import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '../../../generated/prisma/client';
import { createWithUniqueReference } from '../../common/utils/generate-reference';
import { ActivityService } from '../../activity/activity.service';
import { AuditLog } from '../../activity/decorators/audit-log.decorator';
import { PermissionCode } from '../../auth/rbac/rbac.constants';
import {
  assertAdministers,
  assertInScope,
  RbacService,
} from '../../auth/rbac/rbac.service';
import {
  assertSiteExists,
  siteReferentialsWhere,
} from '../../common/utils/site-referentials';
import { DatabaseService } from '../../database/database.service';
import { CreateCorrespondentDto } from './dto/create-correspondent.dto';
import { FindCorrespondantsQueryDto } from './dto/find-correspondents.query.dto';
import { UpdateCorrespondantDto } from './dto/update-correspondent.dto';

const includeType = {
  type: true,
  site: { select: { id: true, code: true, name: true } },
} satisfies Prisma.CorrespondentInclude;

/**
 * A correspondent belongs to one site: only that site's effets use it. Made
 * and managed by whoever holds ADMIN_MANAGE_REFERENTIALS at that site (or
 * globally); everyone else sees their own site's.
 */
@Injectable()
export class CorrespondantService {
  constructor(
    private readonly database: DatabaseService,
    private readonly rbac: RbacService,
    // Read by @AuditLog through `this.activity`.
    private readonly activity: ActivityService,
  ) {}

  @AuditLog({
    action: 'correspondent.created',
    entityType: 'correspondent',
    operation: 'CREATE',
  })
  async create(dto: CreateCorrespondentDto, actingUserId: string) {
    await this.assertManages(dto.siteId, actingUserId);
    await assertSiteExists(this.database, dto.siteId);
    if (dto.typeId) await this.assertTypeExists(dto.typeId);
    return createWithUniqueReference('CP', (code) =>
      this.database.correspondent.create({
        data: { ...dto, code },
        include: includeType,
      }),
    );
  }

  async findAll(query: FindCorrespondantsQueryDto, userId: string) {
    const contains = query.search
      ? { contains: query.search, mode: 'insensitive' as const }
      : undefined;
    const where: Prisma.CorrespondentWhereInput = {
      ...(await siteReferentialsWhere(
        this.rbac,
        this.database,
        userId,
        query.siteId,
      )),
      typeId: query.typeId,
      city: query.city
        ? { contains: query.city, mode: 'insensitive' }
        : undefined,
      status: query.status,
      OR: contains && [
        { name: contains },
        { code: contains },
        { email: contains },
        { phone: contains },
        { mainContact: contains },
      ],
    };

    const [data, total] = await this.database.$transaction([
      this.database.correspondent.findMany({
        where,
        include: includeType,
        orderBy: { name: 'asc' },
        skip: query.skip ?? 0,
        take: query.take ?? 20,
      }),
      this.database.correspondent.count({ where }),
    ]);

    return { data, total, skip: query.skip ?? 0, take: query.take ?? 20 };
  }

  async findOne(uuid: string, userId?: string) {
    const correspondent = await this.database.correspondent.findFirst({
      where: {
        id: uuid,
        ...(userId
          ? await siteReferentialsWhere(this.rbac, this.database, userId)
          : {}),
      },
      include: includeType,
    });
    if (!correspondent) {
      throw new NotFoundException(`Correspondent ${uuid} not found`);
    }
    return correspondent;
  }

  @AuditLog({
    action: 'correspondent.updated',
    entityType: 'correspondent',
    operation: 'UPDATE',
  })
  async update(
    uuid: string,
    dto: UpdateCorrespondantDto,
    actingUserId: string,
  ) {
    const existing = await this.findOne(uuid);
    await this.assertManages(existing.siteId, actingUserId);
    if (dto.typeId) await this.assertTypeExists(dto.typeId);
    return this.database.correspondent.update({
      where: { id: uuid },
      data: dto,
      include: includeType,
    });
  }

  @AuditLog({
    action: 'correspondent.deleted',
    entityType: 'correspondent',
    operation: 'DELETE',
  })
  async remove(uuid: string, actingUserId: string) {
    const existing = await this.findOne(uuid);
    await this.assertManages(existing.siteId, actingUserId);
    try {
      await this.database.correspondent.delete({ where: { id: uuid } });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2003'
      ) {
        throw new BadRequestException(
          'Correspondent is still referenced by one or more courriers',
        );
      }
      throw error;
    }
  }

  private async assertManages(siteId: string, userId: string) {
    const scope = await this.rbac.managedSites(
      userId,
      PermissionCode.AdminManageReferentials,
    );
    assertAdministers(scope);
    assertInScope(scope, siteId);
  }

  private async assertTypeExists(typeId: string) {
    const type = await this.database.correspondentType.findUnique({
      where: { id: typeId },
      select: { id: true },
    });
    if (!type) {
      throw new BadRequestException(`Correspondent type ${typeId} not found`);
    }
  }
}
