import { Injectable, NotFoundException, Optional } from '@nestjs/common';
import {
  NotificationCanal,
  NotificationStatus,
  Prisma,
} from '../generated/prisma/client';
import { DatabaseService } from '../database/database.service';
import { ModuleNotificationsService } from '../administration/settings/module-notifications.service';
import { RealtimeGateway } from '../realtime/realtime.gateway';
import { CreateNotificationDto } from './dto/create-notification.dto';
import { NotificationPreferenceDto } from './dto/set-notification-preferences.dto';
import { isNotificationType, NOTIFICATION_TYPES } from './notification-types';
import { PushService } from './push.service';

// What the inbox returns: the front picks the effet's page by its direction.
const inboxInclude = {
  notification: {
    include: { courrier: { select: { direction: true } } },
  },
} satisfies Prisma.UserNotificationInclude;
type InboxRow = Prisma.UserNotificationGetPayload<{
  include: typeof inboxInclude;
}>;

function toInboxEntry({
  notification: { courrier, ...notification },
  ...entry
}: InboxRow) {
  return {
    ...entry,
    notification: {
      ...notification,
      courrierDirection: courrier?.direction ?? null,
    },
  };
}

@Injectable()
export class NotificationsService {
  constructor(
    private readonly database: DatabaseService,
    private readonly realtime: RealtimeGateway,
    private readonly moduleNotifications: ModuleNotificationsService,
    // « Notifications du navigateur » (optional: unit tests build the service without it).
    @Optional() private readonly push?: PushService,
  ) {}

  // Each recipient whose company doesn't show this type in the application
  // (PA·9), or who turned it off themselves, is left out; with nobody left,
  // nothing is written (null). With a `sourceKey` (a reminder's period, a
  // digest's day), it is created once per source: a repeated run of a job
  // creates nothing (null), as EXPENZO's.
  async create(dto: CreateNotificationDto, sourceKey?: string) {
    const { recipientIds: addressed, params: given, ...data } = dto;
    const recipientIds = await this.wantedBy(
      await this.moduleNotifications.inAppRecipients(addressed, dto.type),
      dto.type,
    );
    if (recipientIds.length === 0) return null;
    const params = await this.paramsOf(dto, given);
    const notification = await this.database.notification
      .create({
        data: {
          ...data,
          ...(params ? { params } : {}),
          ...(sourceKey ? { sourceKey: sourceKey.slice(0, 200) } : {}),
          recipients: {
            createMany: {
              data: recipientIds.map((userId) => ({ userId })),
            },
          },
        },
        include: {
          recipients: true,
          courrier: { select: { direction: true } },
        },
      })
      .catch((error: unknown) => {
        // Already created by an earlier run of the same source.
        if (
          sourceKey &&
          error instanceof Prisma.PrismaClientKnownRequestError &&
          error.code === 'P2002'
        ) {
          return null;
        }
        throw error;
      });
    if (!notification) return null;
    // Every notification (courriers, tasks, reminders, manual) goes through
    // here, so this is the single place the bell gets pushed: each recipient's
    // open tabs receive their inbox entry (as GET /notifications/me gives it),
    // refresh their bell and lists, and show it as a toast in their language.
    const { recipients, courrier, ...row } = notification;
    for (const recipient of recipients) {
      this.realtime.toUser(recipient.userId, 'notification', {
        ...recipient,
        notification: {
          ...row,
          courrierDirection: courrier?.direction ?? null,
        },
      });
    }
    // Web Push to the recipients' browsers, in the background (never blocks the change).
    this.push?.notify(
      recipients.map((r) => r.userId),
      { ...row, courrierDirection: courrier?.direction ?? null },
    );
    return notification;
  }

  /**
   * The params of the texts: the effet's number and subject, the task's
   * title, then what the caller gave (reason, date…). Null when the caller
   * gave none and nothing is linked (an announcement: its message is shown).
   */
  private async paramsOf(
    dto: CreateNotificationDto,
    given: Record<string, string> | undefined,
  ): Promise<Prisma.InputJsonObject | null> {
    const [courrier, instruction] = await Promise.all([
      dto.courrierId
        ? this.database.courrier.findUnique({
            where: { id: dto.courrierId },
            select: { number: true, subject: true },
          })
        : null,
      dto.instructionId
        ? this.database.instruction.findUnique({
            where: { id: dto.instructionId },
            select: { title: true, number: true },
          })
        : null,
    ]);
    if (!given && !courrier && !instruction) return null;
    return {
      ...(courrier
        ? { number: courrier.number, subject: courrier.subject }
        : {}),
      ...(instruction
        ? { title: instruction.title, taskNumber: instruction.number }
        : {}),
      ...given,
    };
  }

  // A role or an access list changed. Never fails the change itself, and
  // nobody is told about their own action.
  async notifyAccessChanged(
    userIds: string[],
    actingUserId: string,
    message: string,
    dossierId?: string,
  ) {
    // Their open tabs reload their rights and lists at once (as EXPENZO's
    // `access` event), whether or not they receive the notification.
    this.realtime.accessChanged(userIds);
    const recipientIds = [...new Set(userIds)].filter(
      (id) => id !== actingUserId,
    );
    if (recipientIds.length === 0) return;
    try {
      await this.create({
        recipientIds,
        type: 'ACCESS_CHANGED',
        message,
        canal: NotificationCanal.IN_APP,
        dossierId,
      });
    } catch (error) {
      console.error('Failed to notify an access change', error);
    }
  }

  // Every type a user can turn off, with whether they receive it.
  async getPreferences(userId: string) {
    const off = await this.database.notificationPreference.findMany({
      where: { userId, enabled: false },
      select: { type: true },
    });
    const disabled = new Set(off.map((pref) => pref.type));
    return Object.entries(NOTIFICATION_TYPES).map(([type, label]) => ({
      type,
      label,
      enabled: !disabled.has(type),
    }));
  }

  async setPreferences(
    userId: string,
    preferences: NotificationPreferenceDto[],
  ) {
    await this.database.$transaction(
      preferences.map(({ type, enabled }) =>
        this.database.notificationPreference.upsert({
          where: { userId_type: { userId, type } },
          create: { userId, type, enabled },
          update: { enabled },
        }),
      ),
    );
    return this.getPreferences(userId);
  }

  private async wantedBy(recipientIds: string[], type: string) {
    const unique = [...new Set(recipientIds)];
    if (!isNotificationType(type) || unique.length === 0) return unique;
    const off = await this.database.notificationPreference.findMany({
      where: { userId: { in: unique }, type, enabled: false },
      select: { userId: true },
    });
    const muted = new Set(off.map((pref) => pref.userId));
    return unique.filter((userId) => !muted.has(userId));
  }

  // A user's own inbox: every notification they were fanned out to, with
  // their individual read/archived status.
  async findMine(userId: string, status?: NotificationStatus) {
    const where: Prisma.UserNotificationWhereInput = { userId, status };
    const rows = await this.database.userNotification.findMany({
      where,
      include: inboxInclude,
      orderBy: { notification: { createdAt: 'desc' } },
    });
    return rows.map(toInboxEntry);
  }

  // Archived ones stay archived.
  async markAllRead(userId: string) {
    const { count } = await this.database.userNotification.updateMany({
      where: { userId, status: NotificationStatus.NOT_READ },
      data: { status: NotificationStatus.READ },
    });
    return { count };
  }

  async markStatus(id: string, userId: string, status: NotificationStatus) {
    const link = await this.database.userNotification.findUnique({
      where: { userId_notificationId: { userId, notificationId: id } },
    });
    if (!link) {
      throw new NotFoundException(`Notification ${id} not found for this user`);
    }
    return toInboxEntry(
      await this.database.userNotification.update({
        where: { userId_notificationId: { userId, notificationId: id } },
        data: { status },
        include: inboxInclude,
      }),
    );
  }
}
