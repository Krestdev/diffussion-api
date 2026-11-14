import { BadRequestException, Injectable } from '@nestjs/common';
import { Prisma } from '../../../generated/prisma/client';
import { ActivityService } from '../../activity/activity.service';
import { Permission } from '../../auth/permissions';
import { AccessService } from '../../auth/access/access.service';
import { DatabaseService } from '../../database/database.service';
import {
  NOTIFICATION_DESCRIPTIONS,
  NOTIFICATION_TYPES,
  NotificationType,
} from '../../notifications/notification-types';
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
 * the application and sent by email — common, and each company's own over it.
 * Above each user's own preferences: an event the company turns off reaches
 * none of its users.
 */
@Injectable()
export class ModuleNotificationsService {
  constructor(
    private readonly database: DatabaseService,
    private readonly access: AccessService,
    private readonly activity: ActivityService,
  ) {}

  /** Every event, with its channels in force at `companyId`. */
  async get(companyId: string | null) {
    const [common, own] = await this.configs(companyId);
    return Object.entries(NOTIFICATION_TYPES).map(([type, label]) => ({
      type,
      label,
      description: NOTIFICATION_DESCRIPTIONS[type as NotificationType],
      ...DEFAULT_CHANNELS,
      ...common[type],
      ...(companyId ? own[type] : {}),
      inherited: companyId ? !(type in own) : false,
    }));
  }

  async getFor(companyId: string | undefined, userId: string) {
    const own = await this.ownCompany(userId);
    if (companyId && companyId !== own) {
      await this.access.assertManages(
        userId,
        Permission.SETTINGS_UPDATE,
        companyId,
        'Ce réglage',
      );
    }
    return this.get(companyId ?? own);
  }

  async update(dto: UpdateModuleNotificationsDto, userId: string) {
    const companyId = targetCompany(
      await this.access.scope(userId, Permission.SETTINGS_UPDATE),
      await this.access.isPlatformAdmin(userId),
      dto.companyId,
    );
    await this.access.assertManages(
      userId,
      Permission.SETTINGS_UPDATE,
      companyId,
      companyId
        ? 'Ce réglage de notifications'
        : 'Le réglage de notifications commun',
    );
    const [common, own] = await this.configs(companyId);
    const config: Config =
      companyId && dto.reset ? {} : { ...(companyId ? own : common) };
    for (const event of dto.events ?? []) {
      config[event.type] = {
        ...config[event.type],
        ...(event.inApp !== undefined ? { inApp: event.inApp } : {}),
        ...(event.email !== undefined ? { email: event.email } : {}),
      };
    }
    const notifications = config as Prisma.InputJsonValue;
    if (companyId) {
      await this.database.companySettings.upsert({
        where: { companyId },
        create: { companyId, notifications },
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
        entityId: companyId ?? String(SETTINGS_ID),
        companyId,
        metadata: { events: dto.events ?? [], reset: Boolean(dto.reset) },
      })
      .catch(() => undefined);
    return this.get(companyId);
  }

  /**
   * Of `userIds`, those whose company shows `type` in the application. A type
   * outside the list (an announcement) always goes through.
   */
  async inAppRecipients(userIds: string[], type: string) {
    if (!(type in NOTIFICATION_TYPES) || userIds.length === 0) return userIds;
    const users = await this.database.user.findMany({
      where: { id: { in: userIds } },
      select: { id: true, companyId: true },
    });
    const companyOf = new Map(users.map((user) => [user.id, user.companyId]));
    const companies = [...new Set(users.map((user) => user.companyId))];
    const shown = new Map<string | null, boolean>();
    await Promise.all(
      companies.map(async (companyId) => {
        const [common, own] = await this.configs(companyId);
        shown.set(
          companyId,
          own[type]?.inApp ?? common[type]?.inApp ?? DEFAULT_CHANNELS.inApp,
        );
      }),
    );
    return userIds.filter((id) => shown.get(companyOf.get(id) ?? null) ?? true);
  }

  private async configs(companyId: string | null): Promise<[Config, Config]> {
    const [common, own] = await Promise.all([
      this.database.appSettings.findUnique({
        where: { id: SETTINGS_ID },
        select: { notifications: true },
      }),
      companyId
        ? this.database.companySettings.findUnique({
            where: { companyId },
            select: { notifications: true },
          })
        : Promise.resolve(null),
    ]);
    return [asConfig(common?.notifications), asConfig(own?.notifications)];
  }

  private async ownCompany(userId: string) {
    const user = await this.database.user.findUnique({
      where: { id: userId },
      select: { companyId: true },
    });
    return user?.companyId ?? null;
  }
}

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
