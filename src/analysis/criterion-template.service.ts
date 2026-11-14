import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '../../generated/prisma/client';
import { ActivityService } from '../activity/activity.service';
import { AuditLog } from '../activity/decorators/audit-log.decorator';
import { Permission } from '../auth/permissions';
import { AccessService } from '../auth/access/access.service';
import { forbidden } from '../auth/access/permissions.guard';
import { DatabaseService } from '../database/database.service';
import {
  CreateCriterionTemplateDto,
  FindCriteriaQueryDto,
  UpdateAnalysisSettingsDto,
  UpdateCriterionTemplateDto,
} from './dto/analysis.dto';

// The common settings live in a single row.
const SETTINGS_ID = 1;

const templateInclude = {
  company: { select: { id: true, code: true, name: true } },
} satisfies Prisma.AnalysisCriterionTemplateInclude;

/**
 * The "document de critères d'analyse" as data: the default grid proposed on
 * every element. Common criteria (no company) serve every company and are managed
 * by a platform administrator; a company's own criteria serve its fiches only
 * and are managed by whoever holds ADMIN_MANAGE_ANALYSIS_CRITERIA there (or
 * its responsible). Editing them never rewrites sheets already filled —
 * criteria are copied onto each element at creation.
 */
@Injectable()
export class CriterionTemplateService {
  constructor(
    private readonly database: DatabaseService,
    private readonly access: AccessService,
    // Read by @AuditLog through `this.activity`.
    private readonly activity: ActivityService,
  ) {}

  @AuditLog({
    action: 'analysis-criterion.created',
    entityType: 'analysis-criterion-template',
    operation: 'CREATE',
  })
  async create(dto: CreateCriterionTemplateDto, actingUserId: string) {
    if (!(await this.access.has(actingUserId, Permission.SETTINGS_UPDATE))) {
      throw forbidden(Permission.SETTINGS_UPDATE);
    }
    const { companyId: requested, ...data } = dto;
    const companyId = companyForNew(
      await this.access.scope(actingUserId, Permission.SETTINGS_UPDATE),
      await this.access.isPlatformAdmin(actingUserId),
      requested,
    );
    await this.access.assertManages(
      actingUserId,
      Permission.SETTINGS_UPDATE,
      companyId,
      companyId ? 'Ce critère' : 'Un critère commun (modèle)',
    );
    await this.assertLabelAvailable(dto.label, companyId);
    return this.database.analysisCriterionTemplate.create({
      data: { ...data, companyId },
      include: templateInclude,
    });
  }

  // The common criteria plus those of one company: `companyId`, else the caller's
  // own.
  private async assertReadsCompany(companyId: string, userId: string) {
    if (!(await this.access.worksAtCompany(userId, companyId))) {
      throw new ForbiddenException(
        'Ces critères appartiennent à un autre société',
      );
    }
  }

  async findAll(query: FindCriteriaQueryDto = {}, actingUserId?: string) {
    if (query.companyId && actingUserId) {
      await this.assertReadsCompany(query.companyId, actingUserId);
    }
    return this.database.analysisCriterionTemplate.findMany({
      where: await this.offeredAt(query.companyId, actingUserId),
      orderBy: [{ order: 'asc' }, { label: 'asc' }],
      include: templateInclude,
    });
  }

  /**
   * What a fiche of `companyId` offers: its company's own criteria — every company
   * has its own (copied from the common model when the company is created).
   * The common model only serves an effet whose company is unknown.
   */
  offeredWhere(
    companyId: string | null,
  ): Prisma.AnalysisCriterionTemplateWhereInput {
    return { companyId: companyId ?? null };
  }

  async findOne(id: string) {
    const template = await this.database.analysisCriterionTemplate.findUnique({
      where: { id },
      include: templateInclude,
    });
    if (!template) {
      throw new NotFoundException(`Criterion template ${id} not found`);
    }
    return template;
  }

  @AuditLog({
    action: 'analysis-criterion.updated',
    entityType: 'analysis-criterion-template',
    operation: 'UPDATE',
  })
  async update(
    id: string,
    dto: UpdateCriterionTemplateDto,
    actingUserId: string,
  ) {
    const template = await this.findOne(id);
    await this.assertManages(actingUserId, template);
    if (dto.label !== undefined && dto.label !== template.label) {
      await this.assertLabelAvailable(dto.label, template.companyId);
    }
    return this.database.analysisCriterionTemplate.update({
      where: { id },
      data: dto,
      include: templateInclude,
    });
  }

  @AuditLog({
    action: 'analysis-criterion.deleted',
    entityType: 'analysis-criterion-template',
    operation: 'DELETE',
  })
  async remove(id: string, actingUserId: string) {
    const template = await this.findOne(id);
    await this.assertManages(actingUserId, template);
    // Criteria already copied onto elements keep their own label, so removing
    // a template never mutates a filled sheet.
    await this.database.analysisCriterionTemplate.delete({ where: { id } });
  }

  /**
   * The fiches' settings: a company's own when it has some, else the common
   * ones — the defaults until an admin changes them. `inherited` says
   * whether a company uses the common settings.
   */
  async getSettingsFor(companyId: string | undefined, userId: string) {
    if (companyId) await this.assertReadsCompany(companyId, userId);
    return this.getSettings(companyId);
  }

  async findOneFor(id: string, userId: string) {
    const template = await this.findOne(id);
    if (
      template.companyId &&
      !(await this.access.worksAtCompany(userId, template.companyId))
    ) {
      throw new NotFoundException(`Criterion template ${id} not found`);
    }
    return template;
  }

  async getSettings(companyId?: string | null) {
    if (companyId) {
      const own = await this.database.analysisCompanySettings.findUnique({
        where: { companyId },
        select: { allowCustomCriteria: true, updatedAt: true },
      });
      if (own) return { ...own, companyId, inherited: false };
    }
    const common = await this.database.analysisSettings.findUnique({
      where: { id: SETTINGS_ID },
      select: { allowCustomCriteria: true, updatedAt: true },
    });
    return {
      ...(common ?? { allowCustomCriteria: true, updatedAt: null }),
      companyId: companyId ?? null,
      inherited: Boolean(companyId),
    };
  }

  async updateSettings(dto: UpdateAnalysisSettingsDto, actingUserId: string) {
    const { companyId, ...data } = dto;
    await this.access.assertManages(
      actingUserId,
      Permission.SETTINGS_UPDATE,
      companyId ?? null,
      companyId ? 'Le réglage de cette société' : 'Le réglage commun',
    );
    if (companyId) {
      await this.database.analysisCompanySettings.upsert({
        where: { companyId },
        create: { companyId, ...data },
        update: data,
      });
    } else {
      await this.database.analysisSettings.upsert({
        where: { id: SETTINGS_ID },
        create: { id: SETTINGS_ID, ...data },
        update: data,
      });
    }
    await this.activity
      .tryRecord({
        action: 'analysis-settings.updated',
        entityType: 'analysis-settings',
        entityId: companyId ?? String(SETTINGS_ID),
        metadata: { ...dto },
      })
      .catch(() => undefined);
    return this.getSettings(companyId);
  }

  private assertManages(
    actingUserId: string,
    template: { label: string; companyId: string | null },
  ) {
    return this.access.assertManages(
      actingUserId,
      Permission.SETTINGS_UPDATE,
      template.companyId,
      template.companyId
        ? `Le critère « ${template.label} »`
        : `Le critère « ${template.label} » (modèle commun)`,
    );
  }

  private async offeredAt(
    companyId: string | undefined,
    actingUserId: string | undefined,
  ): Promise<Prisma.AnalysisCriterionTemplateWhereInput> {
    if (companyId) return this.offeredWhere(companyId);
    if (!actingUserId) return {};
    const user = await this.database.user.findUnique({
      where: { id: actingUserId },
      select: { companyId: true },
    });
    return this.offeredWhere(user?.companyId ?? null);
  }

  private async assertLabelAvailable(label: string, companyId: string | null) {
    const taken = await this.database.analysisCriterionTemplate.findFirst({
      where: { label, companyId },
      select: { id: true },
    });
    if (taken) {
      throw new ConflictException(
        companyId
          ? `A criterion "${label}" already exists for this company`
          : `A common criterion "${label}" already exists`,
      );
    }
  }
}

// A super-administrator makes common criteria unless they name a company;
// someone managing their company makes that company's without naming it.
function companyForNew(
  scope: string[],
  platformAdmin: boolean,
  requested: string | undefined,
): string | null {
  if (requested !== undefined) return requested;
  if (platformAdmin) return null;
  if (scope.length === 1) return scope[0];
  throw new BadRequestException('companyId is required');
}
