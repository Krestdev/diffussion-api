import { Injectable, Logger } from '@nestjs/common';
import webpush from 'web-push';
import { AppConfigService } from '../config/app-config.service';
import { DatabaseService } from '../database/database.service';
import { CourrierDirection } from '../generated/prisma/client';
import {
  NOTIFICATION_FALLBACK,
  NOTIFICATION_TITLES,
  type PortalLanguage,
} from '../portal/notification-titles';
import { notificationBody, readParams } from './notification-texts';
import type { PushSubscribeDto } from './dto/push.dto';

/** What a created notification carries to the push sender. */
export type PushedNotification = {
  id: string;
  type: string;
  message: string | null;
  params: unknown;
  instructionId: string | null;
  courrierId: string | null;
  dossierId: string | null;
  courrierDirection: CourrierDirection | null;
};

/** The JSON the service worker receives (diffusion-ui public/sw.js). */
export type PushPayload = {
  id: string;
  title: string;
  body: string;
  link: string | null;
  /** Same tag as the in-tab pop-up, so the browser shows the notification once. */
  tag: string;
};

const languageOf = (value: string | null | undefined): PortalLanguage =>
  value === 'en' || value === 'it' ? value : 'fr';

/** Where the bell opens a notification (diffusion-ui components/shell/use-bell-notifications.ts). */
export function notificationLink(n: PushedNotification): string | null {
  if (n.instructionId) return `/dashboard/tasks/${n.instructionId}`;
  if (n.courrierId && !n.courrierDirection) return null;
  if (n.courrierId)
    return n.courrierDirection === CourrierDirection.SORTANT
      ? `/dashboard/outgoing/${n.courrierId}`
      : `/dashboard/incoming/${n.courrierId}`;
  if (n.dossierId) return `/dashboard/dossiers/${n.dossierId}`;
  return null;
}

/** The pop-up of a notification in `language`: its type's title, its sentence (or text as written). */
export function pushPayload(
  n: PushedNotification,
  language: PortalLanguage,
): PushPayload {
  const title = (NOTIFICATION_TITLES[n.type] ?? NOTIFICATION_FALLBACK)[
    language
  ];
  return {
    id: n.id,
    title,
    body:
      notificationBody(n.type, readParams(n.params), language) ??
      n.message ??
      '',
    link: notificationLink(n),
    tag: n.id,
  };
}

/**
 * « Notifications du navigateur »: Web Push to the browsers the person subscribed, so a
 * notification reaches them while no Diffusion tab is open. Off (and never failing) while
 * VAPID_PUBLIC_KEY or VAPID_PRIVATE_KEY is empty.
 */
@Injectable()
export class PushService {
  private readonly logger = new Logger('WebPush');
  readonly publicKey: string | null;

  constructor(
    private readonly database: DatabaseService,
    config: AppConfigService,
  ) {
    const publicKey = config.get('VAPID_PUBLIC_KEY');
    const privateKey = config.get('VAPID_PRIVATE_KEY');
    let ready: string | null = null;
    if (publicKey && privateKey) {
      try {
        webpush.setVapidDetails(
          config.get('VAPID_SUBJECT') || 'mailto:admin@example.com',
          publicKey,
          privateKey,
        );
        ready = publicKey;
      } catch (error) {
        this.logger.warn(
          `Web Push is off: invalid VAPID settings (${error instanceof Error ? error.message : String(error)})`,
        );
      }
    } else if (config.get('NODE_ENV') !== 'test') {
      this.logger.log(
        'Web Push is off: VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY are not set',
      );
    }
    this.publicKey = ready;
  }

  get enabled(): boolean {
    return this.publicKey !== null;
  }

  // ------------------------------------------------------------- the person's browser

  /** Saves this browser for the person (a browser is one person's at a time). */
  async subscribe(
    userId: string,
    dto: PushSubscribeDto,
    language?: string | null,
    userAgent?: string,
  ): Promise<void> {
    const data = {
      userId,
      p256dh: dto.keys.p256dh,
      auth: dto.keys.auth,
      language: languageOf(language),
      userAgent: userAgent?.slice(0, 500) ?? null,
    };
    await this.database.pushSubscription.upsert({
      where: { endpoint: dto.endpoint },
      create: { ...data, endpoint: dto.endpoint },
      update: data,
    });
    // Allowing a browser is choosing browser notifications.
    await this.database.user.updateMany({
      where: { id: userId, browserNotifications: false },
      data: { browserNotifications: true },
    });
  }

  /** Forgets this browser for the person (toggle off, sign-out). */
  async unsubscribe(userId: string, endpoint: string): Promise<void> {
    await this.database.pushSubscription.deleteMany({
      where: { endpoint, userId },
    });
  }

  /** The person's choice (console Mon profil), whether push is on here, and their browsers. */
  async preference(userId: string) {
    const [user, browsers] = await Promise.all([
      this.database.user.findUniqueOrThrow({
        where: { id: userId },
        select: { browserNotifications: true },
      }),
      this.database.pushSubscription.count({ where: { userId } }),
    ]);
    return {
      enabled: user.browserNotifications,
      available: this.enabled,
      publicKey: this.publicKey,
      browsers,
    };
  }

  /** On or off; off forgets every browser of the person. */
  async setPreference(userId: string, enabled: boolean) {
    await this.database.user.update({
      where: { id: userId },
      data: { browserNotifications: enabled },
    });
    if (!enabled)
      await this.database.pushSubscription.deleteMany({ where: { userId } });
    return this.preference(userId);
  }

  // ------------------------------------------------------------- sending

  /** Pushes a created notification to its recipients' browsers in the background: never blocks nor throws. */
  notify(userIds: string[], notification: PushedNotification): void {
    if (!this.enabled || userIds.length === 0) return;
    void this.send(userIds, notification).catch((error: unknown) =>
      this.logger.warn(
        `Push of notification ${notification.id} failed: ${error instanceof Error ? error.message : String(error)}`,
      ),
    );
  }

  /** Sends now; returns how many browsers received it. Subscriptions gone (404/410) are removed. */
  async send(
    userIds: string[],
    notification: PushedNotification,
  ): Promise<number> {
    if (!this.enabled || userIds.length === 0) return 0;
    const subscriptions = await this.database.pushSubscription.findMany({
      where: {
        userId: { in: userIds },
        user: { status: 'ACTIVE', browserNotifications: true },
      },
      select: {
        id: true,
        endpoint: true,
        p256dh: true,
        auth: true,
        language: true,
      },
    });
    if (!subscriptions.length) return 0;
    let delivered = 0;
    const gone: string[] = [];
    const used: string[] = [];
    await Promise.all(
      subscriptions.map(async (s) => {
        try {
          await webpush.sendNotification(
            { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
            JSON.stringify(pushPayload(notification, languageOf(s.language))),
            { TTL: 24 * 3600, urgency: 'normal' },
          );
          delivered++;
          used.push(s.id);
        } catch (error) {
          const status = (error as { statusCode?: number }).statusCode;
          if (status === 404 || status === 410) gone.push(s.id);
          else
            this.logger.warn(
              `Push to a browser failed (${status ?? 'no status'}): ${error instanceof Error ? error.message : String(error)}`,
            );
        }
      }),
    );
    if (gone.length)
      await this.database.pushSubscription.deleteMany({
        where: { id: { in: gone } },
      });
    if (used.length)
      await this.database.pushSubscription.updateMany({
        where: { id: { in: used } },
        data: { lastUsedAt: new Date() },
      });
    return delivered;
  }
}
