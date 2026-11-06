import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '../../../generated/prisma/client';
import { ActivityService } from '../../activity/activity.service';
import { AuditLog } from '../../activity/decorators/audit-log.decorator';
import { PermissionCode } from '../../auth/rbac/rbac.constants';
import { RbacService } from '../../auth/rbac/rbac.service';
import {
  assertSiteExists,
  siteReferentialsWhere,
} from '../../common/utils/site-referentials';
import { DatabaseService } from '../../database/database.service';
import { CreateCanalDto } from './dto/create-canal.dto';
import { FindCanalsQueryDto } from './dto/find-canals.query.dto';
import { UpdateCanalDto } from './dto/update-canal.dto';

const canalInclude = {
  site: { select: { id: true, code: true, name: true } },
} satisfies Prisma.CanalInclude;

/**
 * A canal belongs to one site: only that site's effets use it. Made and
 * managed by whoever holds ADMIN_MANAGE_REFERENTIALS at that site (or
 * globally); everyone else sees their own site's.
 */
@Injectable()
export class CanalService {
  constructor(
    private readonly database: DatabaseService,
    private readonly rbac: RbacService,
    // Read by @AuditLog through `this.activity`.
    private readonly activity: ActivityService,
  ) {}

  @AuditLog({
    action: 'canal.created',
    entityType: 'canal',
    operation: 'CREATE',
  })
  async create(dto: CreateCanalDto, actingUserId: string) {
    await this.assertManages(dto.siteId, actingUserId);
    await assertSiteExists(this.database, dto.siteId);
    await this.assertNameAvailable(dto.name, dto.siteId);
    return this.database.canal.create({ data: dto, include: canalInclude });
  }

  async findAll(query: FindCanalsQueryDto, userId: string) {
    return this.database.canal.findMany({
      where: {
        ...(await siteReferentialsWhere(
          this.rbac,
          this.database,
          userId,
          query.siteId,
        )),
        active: query.active,
      },
      orderBy: [{ name: 'asc' }, { siteId: 'asc' }],
      include: canalInclude,
    });
  }

  async findOne(id: string, userId?: string) {
    const canal = await this.database.canal.findFirst({
      where: {
        id,
        ...(userId
          ? await siteReferentialsWhere(this.rbac, this.database, userId)
          : {}),
      },
      include: canalInclude,
    });
    if (!canal) {
      throw new NotFoundException(`Canal ${id} not found`);
    }
    return canal;
  }

  private async assertManages(siteId: string, userId: string) {
    await this.rbac.assertManagesSite(
      userId,
      PermissionCode.AdminManageReferentials,
      siteId,
      'Ce canal',
    );
  }

  private async assertNameAvailable(
    name: string,
    siteId: string,
    exceptId?: string,
  ) {
    const taken = await this.database.canal.findFirst({
      where: { name, siteId, ...(exceptId ? { id: { not: exceptId } } : {}) },
      select: { id: true },
    });
    if (taken) {
      throw new ConflictException(
        `A canal named "${name}" already exists on this site`,
      );
    }
  }

  @AuditLog({
    action: 'canal.updated',
    entityType: 'canal',
    operation: 'UPDATE',
  })
  async update(id: string, dto: UpdateCanalDto, actingUserId: string) {
    const canal = await this.findOne(id);
    await this.assertManages(canal.siteId, actingUserId);
    if (dto.name !== undefined) {
      await this.assertNameAvailable(dto.name, canal.siteId, id);
    }
    return this.database.canal.update({
      where: { id },
      data: dto,
      include: canalInclude,
    });
  }

  @AuditLog({
    action: 'canal.deleted',
    entityType: 'canal',
    operation: 'DELETE',
  })
  async remove(id: string, actingUserId: string) {
    const canal = await this.findOne(id);
    await this.assertManages(canal.siteId, actingUserId);
    try {
      await this.database.canal.delete({ where: { id } });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2003'
      ) {
        throw new ConflictException(
          'This canal is used by effets — deactivate it instead (active: false)',
        );
      }
      throw error;
    }
  }
}
