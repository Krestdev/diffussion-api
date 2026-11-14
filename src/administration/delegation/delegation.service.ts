import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  Prisma,
  CompanyStatus,
  UserStatus,
} from '../../../generated/prisma/client';
import { ActivityService } from '../../activity/activity.service';
import { AuditLog } from '../../activity/decorators/audit-log.decorator';
import { Permission } from '../../auth/permissions';
import { AccessService } from '../../auth/access/access.service';
import { forbidden } from '../../auth/access/permissions.guard';

/** 403 unless `companyId` is the administrator's own company. */
function assertInScope(scope: string[], companyId: string | null) {
  if (companyId === null || !scope.includes(companyId)) {
    throw new ForbiddenException('This belongs to another company');
  }
}
import {
  DEFAULT_TAKE,
  PaginationQueryDto,
} from '../../common/dto/pagination.query.dto';
import { DatabaseService } from '../../database/database.service';
import { CreateDelegationDto } from './dto/create-delegation.dto';
import { UpdateDelegationDto } from './dto/update-delegation.dto';

const include = {
  delegant: { select: { id: true, name: true } },
  delegataire: { select: { id: true, name: true } },
  role: { select: { id: true, name: true } },
  company: { select: { id: true, name: true } },
} satisfies Prisma.DelegationInclude;

// What a delegation resolves to once validated — the shape the checks below
// work on, whether it comes from a create payload or an existing row.
type DelegationShape = {
  delegantId: string;
  delegataireId: string;
  roleId: string;
  companyId: string;
  startDate: Date;
  endDate: Date;
};

@Injectable()
export class DelegationService {
  constructor(
    private readonly database: DatabaseService,
    // Required by @AuditLog, which reads `this.activity`.
    private readonly activity: ActivityService,
    private readonly access: AccessService,
  ) {}

  @AuditLog({
    action: 'delegation.created',
    entityType: 'delegation',
    operation: 'CREATE',
  })
  async create(dto: CreateDelegationDto, actingUserId: string) {
    assertInScope(await this.adminScope(actingUserId), dto.companyId);
    const { startDate, endDate, ...data } = dto;
    const shape: DelegationShape = {
      delegantId: dto.delegantId,
      delegataireId: dto.delegataireId,
      roleId: dto.roleId,
      companyId: dto.companyId,
      // The DTO carries ISO date *strings*; Prisma needs Date objects.
      startDate: new Date(startDate),
      endDate: new Date(endDate),
    };
    await this.assertValid(shape);

    return this.database.delegation.create({
      data: { ...data, startDate: shape.startDate, endDate: shape.endDate },
      include,
    });
  }

  async findAll(query: PaginationQueryDto, actingUserId: string) {
    const scope = await this.adminScope(actingUserId);
    const skip = query.skip ?? 0;
    const take = query.take ?? DEFAULT_TAKE;
    const search: Prisma.DelegationWhereInput = query.search
      ? {
          OR: [
            { responsibility: { contains: query.search, mode: 'insensitive' } },
            {
              delegant: {
                name: { contains: query.search, mode: 'insensitive' },
              },
            },
            {
              delegataire: {
                name: { contains: query.search, mode: 'insensitive' },
              },
            },
            { role: { name: { contains: query.search, mode: 'insensitive' } } },
            {
              company: {
                name: { contains: query.search, mode: 'insensitive' },
              },
            },
          ],
        }
      : {};
    const where: Prisma.DelegationWhereInput = {
      AND: [search, { companyId: { in: scope } }],
    };
    const [data, total] = await this.database.$transaction([
      this.database.delegation.findMany({
        where,
        orderBy: { startDate: 'desc' },
        include,
        skip,
        take,
      }),
      this.database.delegation.count({ where }),
    ]);
    return { data, total, skip, take };
  }

  async findOne(id: string, actingUserId: string) {
    const scope = await this.adminScope(actingUserId);
    const delegation = await this.database.delegation.findUnique({
      where: { id },
      include,
    });
    if (!delegation) {
      throw new NotFoundException(`Delegation ${id} not found`);
    }
    assertInScope(scope, delegation.companyId);
    return delegation;
  }

  @AuditLog({
    action: 'delegation.updated',
    entityType: 'delegation',
    operation: 'UPDATE',
  })
  async update(id: string, dto: UpdateDelegationDto, actingUserId: string) {
    const existing = await this.findOne(id, actingUserId);
    const { startDate, endDate, ...data } = dto;
    const shape: DelegationShape = {
      delegantId: dto.delegantId ?? existing.delegantId,
      delegataireId: dto.delegataireId ?? existing.delegataireId,
      roleId: dto.roleId ?? existing.roleId,
      companyId: dto.companyId ?? existing.companyId,
      startDate: startDate ? new Date(startDate) : existing.startDate,
      endDate: endDate ? new Date(endDate) : existing.endDate,
    };
    assertInScope(await this.adminScope(actingUserId), shape.companyId);
    await this.assertValid(shape, id);

    return this.database.delegation.update({
      where: { id },
      data: {
        ...data,
        ...(startDate !== undefined ? { startDate: shape.startDate } : {}),
        ...(endDate !== undefined ? { endDate: shape.endDate } : {}),
      },
      include,
    });
  }

  @AuditLog({
    action: 'delegation.deleted',
    entityType: 'delegation',
    operation: 'DELETE',
  })
  async remove(id: string, actingUserId: string) {
    await this.findOne(id, actingUserId);
    await this.database.delegation.delete({ where: { id } });
  }

  // Managing delegations is an administration act over people: same right as
  // giving roles (role.assign), in the administrator's own company only.
  private async adminScope(actingUserId: string): Promise<string[]> {
    const scope = await this.access.scope(actingUserId, Permission.ROLE_ASSIGN);
    if (scope.length === 0) throw forbidden(Permission.ROLE_ASSIGN);
    return scope;
  }

  /**
   * A delegation only makes sense if the receiver can actually stand in for
   * the giver: real, active people, a real role, and the company both of them
   * belong to (a delegated role only counts at that company, so a delegation
   * to someone outside the company would grant nothing).
   */
  private async assertValid(shape: DelegationShape, ignoreId?: string) {
    if (shape.endDate.getTime() < shape.startDate.getTime()) {
      throw new BadRequestException('endDate must not be before startDate');
    }
    if (shape.delegantId === shape.delegataireId) {
      throw new BadRequestException('A user cannot delegate to themselves');
    }

    const [delegant, delegataire, role, company] = await Promise.all([
      this.database.user.findUnique({
        where: { id: shape.delegantId },
        select: { name: true, status: true },
      }),
      this.database.user.findUnique({
        where: { id: shape.delegataireId },
        select: { name: true, status: true, companyId: true },
      }),
      this.database.role.findUnique({
        where: { id: shape.roleId },
        select: { name: true, companyId: true, archivedAt: true },
      }),
      this.database.company.findUnique({
        where: { id: shape.companyId },
        select: { name: true, status: true },
      }),
    ]);

    if (!delegant) {
      throw new BadRequestException(`User ${shape.delegantId} not found`);
    }
    if (delegant.status !== UserStatus.ACTIVE) {
      throw new BadRequestException(
        `${delegant.name} is suspended and cannot delegate`,
      );
    }
    if (!delegataire) {
      throw new BadRequestException(`User ${shape.delegataireId} not found`);
    }
    if (delegataire.status !== UserStatus.ACTIVE) {
      throw new BadRequestException(
        `${delegataire.name} is suspended and cannot receive a delegation`,
      );
    }
    if (!role) {
      throw new BadRequestException(`Role ${shape.roleId} not found`);
    }
    if (!company) {
      throw new BadRequestException(`Company ${shape.companyId} not found`);
    }
    // Roles belong to one company: only that company's roles are delegated there.
    if (role.companyId !== shape.companyId) {
      throw new BadRequestException(
        `The role "${role.name}" is not a role of company "${company.name}"`,
      );
    }
    if (role.archivedAt) {
      throw new BadRequestException(
        `The role "${role.name}" is archived — it can't be delegated`,
      );
    }
    if (company.status !== CompanyStatus.ACTIVE) {
      throw new BadRequestException(
        `Company "${company.name}" is inactive — no new activity can be recorded on it`,
      );
    }
    if (delegataire.companyId !== shape.companyId) {
      throw new BadRequestException(
        `${delegataire.name} does not belong to company "${company.name}" — a role can only be delegated within the company`,
      );
    }

    // One can only hand over what one holds: the role (of that company), while
    // belonging there.
    const held = await this.database.userRole.findFirst({
      where: {
        userId: shape.delegantId,
        roleId: shape.roleId,
        user: { companyId: shape.companyId },
      },
      select: { id: true },
    });
    if (!held) {
      throw new BadRequestException(
        `${delegant.name} does not hold the role "${role.name}" at company "${company.name}" — nothing to delegate`,
      );
    }

    // Two open delegations of the same role, at the same company, to the same
    // person would grant nothing extra and make the register ambiguous.
    const overlap = await this.database.delegation.findFirst({
      where: {
        id: ignoreId ? { not: ignoreId } : undefined,
        delegataireId: shape.delegataireId,
        roleId: shape.roleId,
        companyId: shape.companyId,
        startDate: { lte: shape.endDate },
        endDate: { gte: shape.startDate },
      },
      select: { startDate: true, endDate: true },
    });
    if (overlap) {
      throw new BadRequestException(
        `${delegataire.name} already holds this role at "${company.name}" from ${overlap.startDate.toISOString().slice(0, 10)} to ${overlap.endDate.toISOString().slice(0, 10)}`,
      );
    }
  }
}
