import { BadRequestException, Injectable } from '@nestjs/common';
import { Prisma } from '../../../generated/prisma/client';
import { ActivityService } from '../../activity/activity.service';
import { PermissionCode } from '../../auth/rbac/rbac.constants';
import { RbacService, SiteScopeList } from '../../auth/rbac/rbac.service';
import { DatabaseService } from '../../database/database.service';
import { NOTIFICATION_TYPES } from '../../notifications/notification-types';
import { UpdateModuleNotificationsDto } from './dto/module-notifications.dto';

const SETTINGS_ID = 1;

type Channels = { inApp: boolean; email: boolean };
type Config = Record<string, Partial<Channels>>;

// Until set otherwise: in the application, not by email (no mail server
// is wired yet).
const DEFAULT_CHANNELS: Channels = { inApp: true, email: false };

function asConfig(json: Prisma.JsonValue | null | undefined): Config {
  return json && typeof json === 'object' && !Array.isArray(json)
    ? (json as Config)
    : {};
}

/**
 * The module's notifications (PA·9): for each event, whether it is shown in
 * the application and sent by email — common, and each site's own over it.
 * Above each user's own preferences: an event the site turns off reaches
 * none of its users.
 */
@Injectable()
export class ModuleNotificationsService {
  constructor(
    private readonly database: DatabaseService,
    private readonly rbac: RbacService,
    private readonly activity: ActivityService,
  ) {}

  /** Every event, with its channels in force at `siteId`. */
  async get(siteId: string | null) {
    const [common, own] = await this.configs(siteId);
    return Object.entries(NOTIFICATION_TYPES).map(([type, label]) => ({
      type,
      label,
      ...DEFAULT_CHANNELS,
      ...common[type],
      ...(siteId ? own[type] : {}),
      inherited: siteId ? !(type in own) : false,
    }));
  }

  async getFor(siteId: string | undefined, userId: string) {
    return this.get(siteId ?? (await this.ownSite(userId)));
  }

  async update(dto: UpdateModuleNotificationsDto, userId: string) {
    const scope = await this.rbac.managedSites(
      userId,
      PermissionCode.AdminManageSettings,
    );
    const siteId = targetSite(scope, dto.siteId);
    await this.rbac.explainOutOfScope(
      scope,
      siteId,
      siteId
        ? 'Ce réglage de notifications'
        : 'Le réglage de notifications commun',
      PermissionCode.AdminManageSettings,
    );
    const [common, own] = await this.configs(siteId);
    const config: Config =
      siteId && dto.reset ? {} : { ...(siteId ? own : common) };
    for (const event of dto.events ?? []) {
      config[event.type] = {
        ...config[event.type],
        ...(event.inApp !== undefined ? { inApp: event.inApp } : {}),
        ...(event.email !== undefined ? { email: event.email } : {}),
      };
    }
    const notifications = config as Prisma.InputJsonValue;
    if (siteId) {
      await this.database.siteSettings.upsert({
        where: { siteId },
        create: { siteId, notifications },
        update: { notifications },
      });
    } else {
      await this.database.appSettings.upsert({
        where: { id: SETTINGS_ID },
        create: { id: SETTINGS_ID, notifications },
        update: { notifications },
      });
    }
    await this.activity
      .tryRecord({
        action: 'settings.notifications.updated',
        entityType: 'settings',
        entityId: siteId ?? String(SETTINGS_ID),
        siteId,
        metadata: { events: dto.events ?? [], reset: Boolean(dto.reset) },
      })
      .catch(() => undefined);
    return this.get(siteId);
  }

  /**
   * Of `userIds`, those whose site shows `type` in the application. A type
   * outside the list (an announcement) always goes through.
   */
  async inAppRecipients(userIds: string[], type: string) {
    if (!(type in NOTIFICATION_TYPES) || userIds.length === 0) return userIds;
    const users = await this.database.user.findMany({
      where: { id: { in: userIds } },
      select: { id: true, siteId: true },
    });
    const siteOf = new Map(users.map((user) => [user.id, user.siteId]));
    const sites = [...new Set(users.map((user) => user.siteId))];
    const shown = new Map<string | null, boolean>();
    await Promise.all(
      sites.map(async (siteId) => {
        const [common, own] = await this.configs(siteId);
        shown.set(
          siteId,
          own[type]?.inApp ?? common[type]?.inApp ?? DEFAULT_CHANNELS.inApp,
        );
      }),
    );
    return userIds.filter((id) => shown.get(siteOf.get(id) ?? null) ?? true);
  }

  private async configs(siteId: string | null): Promise<[Config, Config]> {
    const [common, own] = await Promise.all([
      this.database.appSettings.findUnique({
        where: { id: SETTINGS_ID },
        select: { notifications: true },
      }),
      siteId
        ? this.database.siteSettings.findUnique({
            where: { siteId },
            select: { notifications: true },
          })
        : Promise.resolve(null),
    ]);
    return [asConfig(common?.notifications), asConfig(own?.notifications)];
  }

  private async ownSite(userId: string) {
    const user = await this.database.user.findUnique({
      where: { id: userId },
      select: { siteId: true },
    });
    return user?.siteId ?? null;
  }
}

function targetSite(
  scope: SiteScopeList,
  requested: string | undefined,
): string | null {
  if (requested) return requested;
  if (scope === 'ALL') return null;
  if (scope.length === 1) return scope[0];
  throw new BadRequestException('siteId is required');
}
