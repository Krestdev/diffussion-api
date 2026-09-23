import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  Prisma,
  SiteStatus,
  UserStatus,
} from '../../../generated/prisma/client';
import { ActivityService } from '../../activity/activity.service';
import { AuditLog } from '../../activity/decorators/audit-log.decorator';
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
  site: { select: { id: true, name: true } },
} satisfies Prisma.DelegationInclude;

// What a delegation resolves to once validated — the shape the checks below
// work on, whether it comes from a create payload or an existing row.
type DelegationShape = {
  delegantId: string;
  delegataireId: string;
  roleId: string;
  siteId: string;
  startDate: Date;
  endDate: Date;
};

@Injectable()
export class DelegationService {
  constructor(
    private readonly database: DatabaseService,
    // Required by @AuditLog, which reads `this.activity`.
    private readonly activity: ActivityService,
  ) {}

  @AuditLog({
    action: 'delegation.created',
    entityType: 'delegation',
    operation: 'CREATE',
  })
  async create(dto: CreateDelegationDto) {
    const { startDate, endDate, ...data } = dto;
    const shape: DelegationShape = {
      delegantId: dto.delegantId,
      delegataireId: dto.delegataireId,
      roleId: dto.roleId,
      siteId: dto.siteId,
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

  async findAll(query: PaginationQueryDto) {
    const skip = query.skip ?? 0;
    const take = query.take ?? DEFAULT_TAKE;
    const where: Prisma.DelegationWhereInput = query.search
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
            { site: { name: { contains: query.search, mode: 'insensitive' } } },
          ],
        }
      : {};
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

  async findOne(id: string) {
    const delegation = await this.database.delegation.findUnique({
      where: { id },
      include,
    });
    if (!delegation) {
      throw new NotFoundException(`Delegation ${id} not found`);
    }
    return delegation;
  }

  @AuditLog({
    action: 'delegation.updated',
    entityType: 'delegation',
    operation: 'UPDATE',
  })
  async update(id: string, dto: UpdateDelegationDto) {
    const existing = await this.findOne(id);
    const { startDate, endDate, ...data } = dto;
    const shape: DelegationShape = {
      delegantId: dto.delegantId ?? existing.delegantId,
      delegataireId: dto.delegataireId ?? existing.delegataireId,
      roleId: dto.roleId ?? existing.roleId,
      siteId: dto.siteId ?? existing.siteId,
      startDate: startDate ? new Date(startDate) : existing.startDate,
      endDate: endDate ? new Date(endDate) : existing.endDate,
    };
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
  async remove(id: string) {
    await this.findOne(id);
    await this.database.delegation.delete({ where: { id } });
  }

  /**
   * A delegation only makes sense if the receiver can actually stand in for
   * the giver: real, active people, a real role, and a site the receiver is
   * already attached to (circuit eligibility is resolved through site
   * assignments, so a delegation to someone outside the site would grant
   * nothing).
   */
  private async assertValid(shape: DelegationShape, ignoreId?: string) {
    if (shape.endDate.getTime() < shape.startDate.getTime()) {
      throw new BadRequestException('endDate must not be before startDate');
    }
    if (shape.delegantId === shape.delegataireId) {
      throw new BadRequestException('A user cannot delegate to themselves');
    }

    const [delegant, delegataire, role, site] = await Promise.all([
      this.database.user.findUnique({
        where: { id: shape.delegantId },
        select: { name: true, status: true },
      }),
      this.database.user.findUnique({
        where: { id: shape.delegataireId },
        select: {
          name: true,
          status: true,
          assignments: {
            where: { siteId: shape.siteId },
            select: { siteId: true },
          },
        },
      }),
      this.database.role.findUnique({
        where: { id: shape.roleId },
        select: { name: true },
      }),
      this.database.site.findUnique({
        where: { id: shape.siteId },
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
    if (!site) {
      throw new BadRequestException(`Site ${shape.siteId} not found`);
    }
    if (site.status !== SiteStatus.ACTIVE) {
      throw new BadRequestException(
        `Site "${site.name}" is inactive — no new activity can be recorded on it`,
      );
    }
    if (delegataire.assignments.length === 0) {
      throw new BadRequestException(
        `${delegataire.name} is not assigned to site "${site.name}" — assign them to it before delegating a role there`,
      );
    }

    // Two open delegations of the same role, at the same site, to the same
    // person would grant nothing extra and make the register ambiguous.
    const overlap = await this.database.delegation.findFirst({
      where: {
        id: ignoreId ? { not: ignoreId } : undefined,
        delegataireId: shape.delegataireId,
        roleId: shape.roleId,
        siteId: shape.siteId,
        startDate: { lte: shape.endDate },
        endDate: { gte: shape.startDate },
      },
      select: { startDate: true, endDate: true },
    });
    if (overlap) {
      throw new BadRequestException(
        `${delegataire.name} already holds this role at "${site.name}" from ${overlap.startDate.toISOString().slice(0, 10)} to ${overlap.endDate.toISOString().slice(0, 10)}`,
      );
    }
  }
}
