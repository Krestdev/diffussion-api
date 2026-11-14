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
import { DatabaseService } from '../../database/database.service';
import { CreateEffetTypeDto } from './dto/create-effet-type.dto';
import { ReferenceModelDto } from './dto/reference-model.dto';
import { FindEffetTypesQueryDto } from './dto/find-effet-types.query.dto';
import { UpdateEffetTypeDto } from './dto/update-effet-type.dto';
import { assertReferenceModelCoherent } from './reference-model';

const effetTypeInclude = {
  company: { select: { id: true, name: true } },
} satisfies Prisma.EffetTypeInclude;

/**
 * Global types (no company) are made by a Diffusion super-administrator and
 * usable on every company; whoever holds settings.update in a company makes and
 * manages the types of their own company. Everyone sees the global types plus
 * those of their own company.
 */
@Injectable()
export class EffetTypeService {
  constructor(
    private readonly database: DatabaseService,
    private readonly access: AccessService,
    // Read by @AuditLog through `this.activity`.
    private readonly activity: ActivityService,
  ) {}

  @AuditLog({
    action: 'effet-type.created',
    entityType: 'effet-type',
    operation: 'CREATE',
  })
  async create(dto: CreateEffetTypeDto, actingUserId: string) {
    const { companyId: requestedCompanyId, referenceModel, ...data } = dto;
    const companyId = await this.companyForNewType(
      actingUserId,
      requestedCompanyId,
    );
    await this.assertManages(actingUserId, companyId);
    await this.assertNameAvailable(dto.name, companyId);
    await this.assertModelUsable(referenceModel, companyId);
    return this.database.effetType.create({
      data: { ...data, companyId, referenceModel: { ...referenceModel } },
      include: effetTypeInclude,
    });
  }

  async findAll(query: FindEffetTypesQueryDto, actingUserId: string) {
    return this.database.effetType.findMany({
      where: {
        AND: [
          await this.visibleTo(actingUserId),
          // A company's types are its own and the common ones.
          query.companyId
            ? { OR: [{ companyId: null }, { companyId: query.companyId }] }
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
    const existing = await this.findById(id);
    await this.assertManages(actingUserId, existing.companyId);
    if (dto.name !== undefined && dto.name !== existing.name) {
      await this.assertNameAvailable(dto.name, existing.companyId);
    }
    const { referenceModel, ...data } = dto;
    if (referenceModel === null && existing.referenceModel) {
      throw new BadRequestException(
        'Un modèle de référence peut être modifié, pas retiré',
      );
    }
    if (referenceModel) {
      await this.assertModelUsable(referenceModel, existing.companyId, id);
    }
    return this.database.effetType.update({
      where: { id },
      data: {
        ...data,
        ...(referenceModel ? { referenceModel: { ...referenceModel } } : {}),
      },
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
    const existing = await this.findById(id);
    await this.assertManages(actingUserId, existing.companyId);
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

  // settings.update in the type's company (a global type: a super-administrator
  // holding it).
  private assertManages(actingUserId: string, companyId: string | null) {
    return this.access.assertManages(
      actingUserId,
      Permission.SETTINGS_UPDATE,
      companyId,
      "Ce type d'effet",
    );
  }

  // Made for the caller's company without naming it; a super-administrator
  // makes global types unless they name a company.
  private async companyForNewType(
    actingUserId: string,
    requested: string | undefined,
  ): Promise<string | null> {
    if (requested !== undefined) return requested;
    if (await this.access.isPlatformAdmin(actingUserId)) return null;
    const own = await this.access.companyOf(actingUserId);
    if (own) return own;
    throw new BadRequestException('companyId is required');
  }

  // Global types, plus the types of the caller's own company.
  private async visibleTo(
    actingUserId: string,
  ): Promise<Prisma.EffetTypeWhereInput> {
    const companyId = await this.access.companyOf(actingUserId);
    return {
      OR: [{ companyId: null }, ...(companyId ? [{ companyId }] : [])],
    };
  }

  // Each type counts on its own: two with one prefix would give the same
  // references. A global type is usable everywhere, so it meets them all.
  private async assertModelUsable(
    model: ReferenceModelDto,
    companyId: string | null,
    ownId?: string,
  ) {
    assertReferenceModelCoherent(model);
    const taken = await this.database.effetType.findFirst({
      where: {
        id: { not: ownId },
        referenceModel: { path: ['prefix'], equals: model.prefix },
        ...(companyId ? { OR: [{ companyId: null }, { companyId }] } : {}),
      },
      select: { name: true },
    });
    if (taken) {
      throw new ConflictException(
        `Le préfixe "${model.prefix}" est déjà utilisé par le type "${taken.name}"`,
      );
    }
  }

  private async assertNameAvailable(name: string, companyId: string | null) {
    const taken = await this.database.effetType.findFirst({
      where: { name, companyId },
      select: { id: true },
    });
    if (taken) {
      throw new ConflictException(
        `An effet type named "${name}" already exists`,
      );
    }
  }
}
