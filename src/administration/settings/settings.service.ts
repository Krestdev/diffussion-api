import { BadRequestException, Injectable } from '@nestjs/common';
import { Prisma } from '../../generated/prisma/client';
import { ActivityService } from '../../activity/activity.service';
import { Permission } from '../../auth/permissions';
import { AccessService } from '../../auth/access/access.service';
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
 * The settings (PA·5, PA·8): common ones, which every company inherits, and
 * each company's own over them. A company's administrator — its responsible, or
 * whoever holds ADMIN_MANAGE_SETTINGS there — sets their company's; a platform
 * administrator sets the common ones (and any company's).
 */
@Injectable()
export class SettingsService {
  constructor(
    private readonly database: DatabaseService,
    private readonly access: AccessService,
    private readonly activity: ActivityService,
  ) {}

  /**
   * The settings in force at `companyId` (the common ones without a company):
   * defaults, then the common values, then the company's own. `inherited`
   * lists the keys the company doesn't set itself.
   */
  async get(companyId?: string | null) {
    const [common, own] = await Promise.all([
      this.database.appSettings.findUnique({ where: { id: SETTINGS_ID } }),
      companyId
        ? this.database.companySettings.findUnique({ where: { companyId } })
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
      ...(companyId ? ownValues : {}),
    } as GeneralSettings;
    return {
      companyId: companyId ?? null,
      ...values,
      inherited: companyId
        ? GENERAL_SETTING_KEYS.filter((key) => !(key in ownValues))
        : [],
      updatedAt:
        (companyId ? own?.updatedAt : null) ?? common?.updatedAt ?? null,
    };
  }

  /**
   * Readable by every signed-in user — their own company's (e.g. the agents'
   * capacity when assigning a task, the session timeout); another company's
   * only for whoever administers it.
   */
  async getFor(query: SettingsQueryDto, userId: string) {
    const own = await this.ownCompany(userId);
    const companyId = query.companyId ?? own;
    if (query.companyId && query.companyId !== own) {
      await this.access.assertManages(
        userId,
        Permission.SETTINGS_UPDATE,
        query.companyId,
        'Ce réglage',
      );
    }
    return this.get(companyId);
  }

  async update(dto: UpdateSettingsDto, userId: string) {
    const { companyId: requested, reset, ...changes } = dto;
    const companyId = targetCompany(
      await this.access.scope(userId, Permission.SETTINGS_UPDATE),
      await this.access.isPlatformAdmin(userId),
      requested,
    );
    await this.access.assertManages(
      userId,
      Permission.SETTINGS_UPDATE,
      companyId,
      companyId ? 'Ce réglage' : 'Ce réglage commun',
    );
    if (!companyId && reset?.length) {
      throw new BadRequestException(
        'Only a company gives a setting up: the common settings have no parent',
      );
    }

    const before = await this.get(companyId);
    if (companyId) {
      const own = await this.database.companySettings.findUnique({
        where: { companyId },
        select: { values: true },
      });
      const values: Values = { ...asValues(own?.values), ...changes };
      for (const key of reset ?? []) delete values[key];
      await this.database.companySettings.upsert({
        where: { companyId },
        create: { companyId, values: values as Prisma.InputJsonValue },
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
    const after = await this.get(companyId);

    // Before / after, for the audit journal.
    const diff: Record<string, [unknown, unknown]> = {};
    for (const key of GENERAL_SETTING_KEYS) {
      if (before[key] !== after[key]) diff[key] = [before[key], after[key]];
    }
    await this.activity
      .tryRecord({
        action: 'settings.updated',
        entityType: 'settings',
        entityId: companyId ?? String(SETTINGS_ID),
        companyId,
        changes: diff,
        metadata: {
          scope: companyId ? 'company' : 'common',
          reset: reset ?? [],
        },
      })
      .catch(() => undefined);
    return after;
  }

  private async ownCompany(userId: string) {
    const user = await this.database.user.findUnique({
      where: { id: userId },
      select: { companyId: true },
    });
    return user?.companyId ?? null;
  }
}

// The settings PATCH applies to: the company named, else the only company the
// caller manages, else (a platform administrator) the common ones.
function targetCompany(
  scope: string[],
  platformAdmin: boolean,
  requested: string | undefined,
): string | null {
  if (requested) return requested;
  // A super-administrator naming no company changes the common ones.
  if (platformAdmin) return null;
  if (scope.length === 1) return scope[0];
  throw new BadRequestException('companyId is required');
}
