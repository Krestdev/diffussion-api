import { BadRequestException, Injectable } from '@nestjs/common';
import { Prisma } from '../../../generated/prisma/client';
import { ActivityService } from '../../activity/activity.service';
import { PermissionCode } from '../../auth/rbac/rbac.constants';
import { RbacService, SiteScopeList } from '../../auth/rbac/rbac.service';
import { DatabaseService } from '../../database/database.service';
import { SettingsQueryDto, UpdateSettingsDto } from './dto/update-settings.dto';
import {
  GENERAL_SETTING_KEYS,
  GENERAL_SETTINGS_DEFAULTS,
  type GeneralSettingKey,
  type GeneralSettings,
} from './settings.defaults';

// The common settings live in a single row.
const SETTINGS_ID = 1;

type Values = Partial<Record<GeneralSettingKey, unknown>>;

function asValues(json: Prisma.JsonValue | null | undefined): Values {
  return json && typeof json === 'object' && !Array.isArray(json) ? json : {};
}

/**
 * The settings (PA·5, PA·8): common ones, which every site inherits, and
 * each site's own over them. A site's administrator — its responsible, or
 * whoever holds ADMIN_MANAGE_SETTINGS there — sets their site's; a platform
 * administrator sets the common ones (and any site's).
 */
@Injectable()
export class SettingsService {
  constructor(
    private readonly database: DatabaseService,
    private readonly rbac: RbacService,
    private readonly activity: ActivityService,
  ) {}

  /**
   * The settings in force at `siteId` (the common ones without a site):
   * defaults, then the common values, then the site's own. `inherited`
   * lists the keys the site doesn't set itself.
   */
  async get(siteId?: string | null) {
    const [common, own] = await Promise.all([
      this.database.appSettings.findUnique({ where: { id: SETTINGS_ID } }),
      siteId
        ? this.database.siteSettings.findUnique({ where: { siteId } })
        : null,
    ]);
    const commonValues: Values = {
      ...asValues(common?.values),
      // Kept in its own column too, for older readers.
      ...(common && common.maxActiveInstructionsPerAgent !== null
        ? {
            maxActiveInstructionsPerAgent: common.maxActiveInstructionsPerAgent,
          }
        : {}),
    };
    const ownValues = asValues(own?.values);
    const values = {
      ...GENERAL_SETTINGS_DEFAULTS,
      ...commonValues,
      ...(siteId ? ownValues : {}),
    } as GeneralSettings;
    return {
      siteId: siteId ?? null,
      ...values,
      inherited: siteId
        ? GENERAL_SETTING_KEYS.filter((key) => !(key in ownValues))
        : [],
      updatedAt: (siteId ? own?.updatedAt : null) ?? common?.updatedAt ?? null,
    };
  }

  /**
   * Readable by every signed-in user — their own site's (e.g. the agents'
   * capacity when assigning a task, the session timeout); another site's
   * only for whoever administers it.
   */
  async getFor(query: SettingsQueryDto, userId: string) {
    const own = await this.ownSite(userId);
    const siteId = query.siteId ?? own;
    if (query.siteId && query.siteId !== own) {
      await this.rbac.assertManagesSite(
        userId,
        PermissionCode.AdminManageSettings,
        query.siteId,
        'Ce réglage',
      );
    }
    return this.get(siteId);
  }

  async update(dto: UpdateSettingsDto, userId: string) {
    const { siteId: requested, reset, ...changes } = dto;
    const scope = await this.rbac.managedSites(
      userId,
      PermissionCode.AdminManageSettings,
    );
    const siteId = targetSite(scope, requested);
    await this.rbac.explainOutOfScope(
      scope,
      siteId,
      siteId ? 'Ce réglage' : 'Ce réglage commun',
      PermissionCode.AdminManageSettings,
    );
    if (!siteId && reset?.length) {
      throw new BadRequestException(
        'Only a site gives a setting up: the common settings have no parent',
      );
    }

    const before = await this.get(siteId);
    if (siteId) {
      const own = await this.database.siteSettings.findUnique({
        where: { siteId },
        select: { values: true },
      });
      const values: Values = { ...asValues(own?.values), ...changes };
      for (const key of reset ?? []) delete values[key];
      await this.database.siteSettings.upsert({
        where: { siteId },
        create: { siteId, values: values as Prisma.InputJsonValue },
        update: { values: values as Prisma.InputJsonValue },
      });
    } else {
      const common = await this.database.appSettings.findUnique({
        where: { id: SETTINGS_ID },
        select: { values: true },
      });
      const values: Values = { ...asValues(common?.values), ...changes };
      const column =
        'maxActiveInstructionsPerAgent' in changes
          ? {
              maxActiveInstructionsPerAgent:
                changes.maxActiveInstructionsPerAgent,
            }
          : {};
      await this.database.appSettings.upsert({
        where: { id: SETTINGS_ID },
        create: {
          id: SETTINGS_ID,
          values: values as Prisma.InputJsonValue,
          ...column,
        },
        update: { values: values as Prisma.InputJsonValue, ...column },
      });
    }
    const after = await this.get(siteId);

    // Before / after, for the audit journal.
    const diff: Record<string, [unknown, unknown]> = {};
    for (const key of GENERAL_SETTING_KEYS) {
      if (before[key] !== after[key]) diff[key] = [before[key], after[key]];
    }
    await this.activity
      .tryRecord({
        action: 'settings.updated',
        entityType: 'settings',
        entityId: siteId ?? String(SETTINGS_ID),
        siteId,
        changes: diff,
        metadata: { scope: siteId ? 'site' : 'common', reset: reset ?? [] },
      })
      .catch(() => undefined);
    return after;
  }

  private async ownSite(userId: string) {
    const user = await this.database.user.findUnique({
      where: { id: userId },
      select: { siteId: true },
    });
    return user?.siteId ?? null;
  }
}

// The settings PATCH applies to: the site named, else the only site the
// caller manages, else (a platform administrator) the common ones.
function targetSite(
  scope: SiteScopeList,
  requested: string | undefined,
): string | null {
  if (requested) return requested;
  if (scope === 'ALL') return null;
  if (scope.length === 1) return scope[0];
  throw new BadRequestException('siteId is required');
}
