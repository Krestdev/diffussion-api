import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, UserStatus } from '../../generated/prisma/client';
import { ActivityService } from '../../activity/activity.service';
import { AuditLog } from '../../activity/decorators/audit-log.decorator';
import { Permission } from '../../auth/permissions';
import { AccessService } from '../../auth/access/access.service';
import { createDefaultRoles } from '../../auth/default-roles';
import { DatabaseService } from '../../database/database.service';
import { UpdateCompanyDto } from './dto/update-company.dto';
import { DEFAULT_TAKE } from '../../common/dto/pagination.query.dto';
import { FindCompaniesQueryDto } from './dto/find-companies.query.dto';

const includeResponsible = {
  responsible: {
    select: { id: true, name: true, email: true },
  },
} satisfies Prisma.CompanyInclude;

/**
 * What every new company starts with (created here or from the core's directory): its own analysis
 * criteria, a copy of the common model it then adapts, and its default roles (ADMIN, holding every
 * permission, Réceptionniste, Dispatcher, Admin dispatcher). `adminId` (its responsible) holds ADMIN.
 */
export async function setUpCompany(
  tx: Prisma.TransactionClient,
  companyId: string,
  adminId: string | null,
): Promise<void> {
  const model = await tx.analysisCriterionTemplate.findMany({
    where: { companyId: null },
    select: {
      label: true,
      description: true,
      order: true,
      isActive: true,
      appliedByDefault: true,
    },
  });
  if (model.length) {
    await tx.analysisCriterionTemplate.createMany({
      data: model.map((criterion) => ({ ...criterion, companyId })),
    });
  }
  await createDefaultRoles(tx, companyId, {
    adminIds: adminId ? [adminId] : [],
  });
}

@Injectable()
export class CompanyService {
  constructor(
    private readonly database: DatabaseService,
    // Read by @AuditLog through `this.activity`.
    private readonly activity: ActivityService,
    private readonly access: AccessService,
  ) {}

  // The user's own company, the one they are responsible of, and those
  // delegated to them (permissions 2.0.0: nobody sees every company).
  private visibleTo(userId: string): Prisma.CompanyWhereInput {
    return {
      OR: [
        { users: { some: { id: userId } } },
        { responsibleId: userId },
        { delegations: { some: { delegataireId: userId } } },
      ],
    };
  }

  async findVisible(uuid: string, userId: string) {
    const company = await this.database.company.findFirst({
      where: { id: uuid, AND: [this.visibleTo(userId)] },
      include: includeResponsible,
    });
    if (!company) throw new NotFoundException(`Company ${uuid} not found`);
    return company;
  }

  async findAll(query: FindCompaniesQueryDto = {}, userId?: string) {
    const contains = query.search
      ? { contains: query.search, mode: 'insensitive' as const }
      : undefined;
    const where: Prisma.CompanyWhereInput = {
      AND: userId ? [this.visibleTo(userId)] : [],
      status: query.status,
      responsibleId: query.responsibleId,
      city: query.city
        ? { contains: query.city, mode: 'insensitive' }
        : undefined,
      OR: contains && [
        { name: contains },
        { code: contains },
        { city: contains },
        { responsible: { name: contains } },
      ],
    };
    const skip = query.skip ?? 0;
    const take = query.take ?? DEFAULT_TAKE;

    const [data, total] = await this.database.$transaction([
      this.database.company.findMany({
        where,
        orderBy: { name: 'asc' },
        include: includeResponsible,
        skip,
        take,
      }),
      this.database.company.count({ where }),
    ]);

    return { data, total, skip, take };
  }

  async findOne(uuid: string) {
    const company = await this.database.company.findUnique({
      where: { id: uuid },
      include: includeResponsible,
    });
    if (!company) {
      throw new NotFoundException(`Company ${uuid} not found`);
    }
    return company;
  }

  @AuditLog({
    action: 'company.updated',
    entityType: 'company',
    operation: 'UPDATE',
  })
  async update(uuid: string, dto: UpdateCompanyDto, actingUserId: string) {
    // company.update in their own company: its city and its responsible.
    await this.access.assertManages(
      actingUserId,
      Permission.COMPANY_UPDATE,
      uuid,
      'Cette société',
    );
    const company = await this.findOne(uuid);
    const newResponsibleId =
      dto.responsibleId && dto.responsibleId !== company.responsibleId
        ? dto.responsibleId
        : null;
    if (newResponsibleId) {
      await this.assertEligibleResponsible(newResponsibleId, uuid);
    }
    return this.database.company.update({
      where: { id: uuid },
      data: dto,
      include: includeResponsible,
    });
  }

  // The responsible is the company's administrator (users, delegations, audit
  // of that company — its designation): an active person of
  // that company, responsible of no other company.
  private async assertEligibleResponsible(userId: string, companyId: string) {
    const user = await this.database.user.findUnique({
      where: { id: userId },
      select: {
        status: true,
        name: true,
        companyId: true,
        managedCompanies: { select: { id: true, name: true } },
      },
    });
    if (!user) {
      throw new BadRequestException(`User ${userId} not found`);
    }
    if (user.status !== UserStatus.ACTIVE) {
      throw new BadRequestException(
        `${user.name} is suspended and cannot be made company responsible`,
      );
    }
    // A company is a company of the core: its responsible works for it.
    if (user.companyId !== companyId) {
      throw new BadRequestException(
        `${user.name} does not belong to this company and cannot be its responsible`,
      );
    }
    const other = user.managedCompanies.find(
      (managed) => managed.id !== companyId,
    );
    if (other) {
      throw new BadRequestException(
        `${user.name} is already the responsible of company "${other.name}"`,
      );
    }
  }
}
