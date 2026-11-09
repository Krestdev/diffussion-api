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
import { PermissionCode } from '../auth/rbac/rbac.constants';
import { RbacService, SiteScopeList } from '../auth/rbac/rbac.service';
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
  site: { select: { id: true, code: true, name: true } },
} satisfies Prisma.AnalysisCriterionTemplateInclude;

/**
 * The "document de critères d'analyse" as data: the default grid proposed on
 * every element. Common criteria (no site) serve every site and are managed
 * by a platform administrator; a site's own criteria serve its fiches only
 * and are managed by whoever holds ADMIN_MANAGE_ANALYSIS_CRITERIA there (or
 * its responsible). Editing them never rewrites sheets already filled —
 * criteria are copied onto each element at creation.
 */
@Injectable()
export class CriterionTemplateService {
  constructor(
    private readonly database: DatabaseService,
    private readonly rbac: RbacService,
    // Read by @AuditLog through `this.activity`.
    private readonly activity: ActivityService,
  ) {}

  @AuditLog({
    action: 'analysis-criterion.created',
    entityType: 'analysis-criterion-template',
    operation: 'CREATE',
  })
  async create(dto: CreateCriterionTemplateDto, actingUserId: string) {
    const scope = await this.manageScope(actingUserId);
    const { siteId: requested, ...data } = dto;
    const siteId = siteForNew(scope, requested);
    await this.rbac.explainOutOfScope(
      scope,
      siteId,
      siteId ? 'Ce critère' : 'Un critère commun (modèle)',
      PermissionCode.AdminManageAnalysisCriteria,
    );
    await this.assertLabelAvailable(dto.label, siteId);
    return this.database.analysisCriterionTemplate.create({
      data: { ...data, siteId },
      include: templateInclude,
    });
  }

  // The common criteria plus those of one site: `siteId`, else the caller's
  // own (every site's for a platform administrator).
  private async assertReadsSite(siteId: string, userId: string) {
    if (
      !(await this.rbac.worksAtSite(
        userId,
        PermissionCode.AnalysisRead,
        siteId,
      ))
    ) {
      throw new ForbiddenException('Ces critères appartiennent à un autre site');
    }
  }

  async findAll(query: FindCriteriaQueryDto = {}, actingUserId?: string) {
    if (query.siteId && actingUserId) {
      await this.assertReadsSite(query.siteId, actingUserId);
    }
    return this.database.analysisCriterionTemplate.findMany({
      where: await this.offeredAt(query.siteId, actingUserId),
      orderBy: [{ order: 'asc' }, { label: 'asc' }],
      include: templateInclude,
    });
  }

  /**
   * What a fiche of `siteId` offers: its site's own criteria — every site
   * has its own (copied from the common model when the site is created).
   * The common model only serves an effet whose site is unknown.
   */
  offeredWhere(
    siteId: string | null,
  ): Prisma.AnalysisCriterionTemplateWhereInput {
    return { siteId: siteId ?? null };
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
      await this.assertLabelAvailable(dto.label, template.siteId);
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
   * The fiches' settings: a site's own when it has some, else the common
   * ones — the defaults until an admin changes them. `inherited` says
   * whether a site uses the common settings.
   */
  async getSettingsFor(siteId: string | undefined, userId: string) {
    if (siteId) await this.assertReadsSite(siteId, userId);
    return this.getSettings(siteId);
  }

  async findOneFor(id: string, userId: string) {
    const template = await this.findOne(id);
    if (
      template.siteId &&
      !(await this.rbac.worksAtSite(
        userId,
        PermissionCode.AnalysisRead,
        template.siteId,
      ))
    ) {
      throw new NotFoundException(`Criterion template ${id} not found`);
    }
    return template;
  }

  async getSettings(siteId?: string | null) {
    if (siteId) {
      const own = await this.database.analysisSiteSettings.findUnique({
        where: { siteId },
        select: { allowCustomCriteria: true, updatedAt: true },
      });
      if (own) return { ...own, siteId, inherited: false };
    }
    const common = await this.database.analysisSettings.findUnique({
      where: { id: SETTINGS_ID },
      select: { allowCustomCriteria: true, updatedAt: true },
    });
    return {
      ...(common ?? { allowCustomCriteria: true, updatedAt: null }),
      siteId: siteId ?? null,
      inherited: Boolean(siteId),
    };
  }

  async updateSettings(dto: UpdateAnalysisSettingsDto, actingUserId: string) {
    const { siteId, ...data } = dto;
    await this.rbac.assertManagesSite(
      actingUserId,
      PermissionCode.AdminManageAnalysisCriteria,
      siteId ?? null,
      siteId ? 'Le réglage de ce site' : 'Le réglage commun',
    );
    if (siteId) {
      await this.database.analysisSiteSettings.upsert({
        where: { siteId },
        create: { siteId, ...data },
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
        entityId: siteId ?? String(SETTINGS_ID),
        metadata: { ...dto },
      })
      .catch(() => undefined);
    return this.getSettings(siteId);
  }

  // 'ALL' through a global grant, else the sites the caller manages
  // (holding the permission there, or being their responsible).
  private async manageScope(actingUserId: string): Promise<SiteScopeList> {
    const scope = await this.rbac.managedSites(
      actingUserId,
      PermissionCode.AdminManageAnalysisCriteria,
    );
    // Says why when the permission is held nowhere.
    await this.rbac.explainOutOfScope(
      scope === 'ALL' || scope.length ? 'ALL' : scope,
      null,
      'Ce critère',
      PermissionCode.AdminManageAnalysisCriteria,
    );
    return scope;
  }

  private assertManages(
    actingUserId: string,
    template: { label: string; siteId: string | null },
  ) {
    return this.rbac.assertManagesSite(
      actingUserId,
      PermissionCode.AdminManageAnalysisCriteria,
      template.siteId,
      template.siteId
        ? `Le critère « ${template.label} »`
        : `Le critère « ${template.label} » (modèle commun)`,
    );
  }

  private async offeredAt(
    siteId: string | undefined,
    actingUserId: string | undefined,
  ): Promise<Prisma.AnalysisCriterionTemplateWhereInput> {
    if (siteId) return this.offeredWhere(siteId);
    if (!actingUserId) return {};
    if (
      await this.rbac.hasGlobalPermission(
        actingUserId,
        PermissionCode.AdminManageAnalysisCriteria,
      )
    ) {
      return {};
    }
    const user = await this.database.user.findUnique({
      where: { id: actingUserId },
      select: { siteId: true },
    });
    return this.offeredWhere(user?.siteId ?? null);
  }

  private async assertLabelAvailable(label: string, siteId: string | null) {
    const taken = await this.database.analysisCriterionTemplate.findFirst({
      where: { label, siteId },
      select: { id: true },
    });
    if (taken) {
      throw new ConflictException(
        siteId
          ? `A criterion "${label}" already exists for this site`
          : `A common criterion "${label}" already exists`,
      );
    }
  }
}

// A platform administrator makes common criteria unless they name a site;
// someone managing a single site makes that site's without naming it.
function siteForNew(
  scope: SiteScopeList,
  requested: string | undefined,
): string | null {
  if (requested !== undefined) return requested;
  if (scope === 'ALL') return null;
  if (scope.length === 1) return scope[0];
  throw new BadRequestException('siteId is required');
}
