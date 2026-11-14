import {
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
  assertCompanyExists,
  companyReferentialsWhere,
} from '../../common/utils/company-referentials';
import { DatabaseService } from '../../database/database.service';
import { CreateCanalDto } from './dto/create-canal.dto';
import { FindCanalsQueryDto } from './dto/find-canals.query.dto';
import { UpdateCanalDto } from './dto/update-canal.dto';

const canalInclude = {
  company: { select: { id: true, code: true, name: true } },
} satisfies Prisma.CanalInclude;

/**
 * A canal belongs to one company: only that company's effets use it. Made and
 * managed by whoever holds settings.update in that company; everyone sees
 * their own company's.
 */
@Injectable()
export class CanalService {
  constructor(
    private readonly database: DatabaseService,
    private readonly access: AccessService,
    // Read by @AuditLog through `this.activity`.
    private readonly activity: ActivityService,
  ) {}

  @AuditLog({
    action: 'canal.created',
    entityType: 'canal',
    operation: 'CREATE',
  })
  async create(dto: CreateCanalDto, actingUserId: string) {
    await this.assertManages(dto.companyId, actingUserId);
    await assertCompanyExists(this.database, dto.companyId);
    await this.assertNameAvailable(dto.name, dto.companyId);
    return this.database.canal.create({ data: dto, include: canalInclude });
  }

  async findAll(query: FindCanalsQueryDto, userId: string) {
    return this.database.canal.findMany({
      where: {
        ...(await companyReferentialsWhere(
          this.access,
          this.database,
          userId,
          query.companyId,
        )),
        active: query.active,
      },
      orderBy: [{ name: 'asc' }, { companyId: 'asc' }],
      include: canalInclude,
    });
  }

  async findOne(id: string, userId?: string) {
    const canal = await this.database.canal.findFirst({
      where: {
        id,
        ...(userId
          ? await companyReferentialsWhere(this.access, this.database, userId)
          : {}),
      },
      include: canalInclude,
    });
    if (!canal) {
      throw new NotFoundException(`Canal ${id} not found`);
    }
    return canal;
  }

  private async assertManages(companyId: string, userId: string) {
    await this.access.assertManages(
      userId,
      Permission.SETTINGS_UPDATE,
      companyId,
      'Ce canal',
    );
  }

  private async assertNameAvailable(
    name: string,
    companyId: string,
    exceptId?: string,
  ) {
    const taken = await this.database.canal.findFirst({
      where: {
        name,
        companyId,
        ...(exceptId ? { id: { not: exceptId } } : {}),
      },
      select: { id: true },
    });
    if (taken) {
      throw new ConflictException(
        `A canal named "${name}" already exists on this company`,
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
    await this.assertManages(canal.companyId, actingUserId);
    if (dto.name !== undefined) {
      await this.assertNameAvailable(dto.name, canal.companyId, id);
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
    await this.assertManages(canal.companyId, actingUserId);
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
