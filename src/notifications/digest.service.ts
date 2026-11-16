import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import {
  NotificationCanal,
  NotificationStatus,
  UserStatus,
} from '../generated/prisma/client';
import { AppConfigService } from '../config/app-config.service';
import { DatabaseService } from '../database/database.service';
import { TO_DO_TYPES } from './notification-types';
import { NotificationsService } from './notifications.service';

/** How far back an unread "to do" notification still counts in the summary. */
const WINDOW_DAYS = 30;

/**
 * "Résumé quotidien de mes éléments en attente (08:00)", as EXPENZO's DigestService: every
 * morning, each user with unread "to do" notifications (TO_DO_TYPES) gets one summary in the
 * application. Created once per user and day (sourceKey digest:<day>:<user>), so a second run or
 * a second API instance sends nothing twice.
 */
@Injectable()
export class DigestService {
  private readonly logger = new Logger(DigestService.name);

  constructor(
    private readonly database: DatabaseService,
    private readonly notifications: NotificationsService,
    private readonly config: AppConfigService,
  ) {}

  @Cron('0 8 * * *', { timeZone: 'Africa/Douala' })
  async morning(): Promise<void> {
    if (this.config.get('NODE_ENV') === 'test') return;
    try {
      await this.run();
    } catch (error) {
      this.logger.error(
        'Daily digest failed',
        error instanceof Error ? error.stack : String(error),
      );
    }
  }

  /** Creates the summaries of `now`'s day; returns how many. */
  async run(now = new Date()): Promise<number> {
    const since = new Date(now.getTime() - WINDOW_DAYS * 86_400_000);
    const groups = await this.database.userNotification.groupBy({
      by: ['userId'],
      where: {
        status: NotificationStatus.NOT_READ,
        user: { status: UserStatus.ACTIVE },
        notification: {
          type: { in: [...TO_DO_TYPES] },
          createdAt: { gte: since },
        },
      },
      _count: { _all: true },
    });
    const day = now.toISOString().slice(0, 10);
    let created = 0;
    for (const group of groups) {
      const count = group._count._all;
      if (!count) continue;
      const notification = await this.notifications.create(
        {
          recipientIds: [group.userId],
          type: 'DAILY_DIGEST',
          message: `${count} élément${count > 1 ? 's attendent' : ' attend'} votre action.`,
          canal: NotificationCanal.IN_APP,
          params: { count: String(count) },
        },
        `digest:${day}:${group.userId}`,
      );
      if (notification) created++;
    }
    return created;
  }
}
