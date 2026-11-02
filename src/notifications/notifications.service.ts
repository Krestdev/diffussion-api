import { Injectable, NotFoundException } from '@nestjs/common';
import { NotificationStatus, Prisma } from '../../generated/prisma/client';
import { DatabaseService } from '../database/database.service';
import { RealtimeGateway } from '../realtime/realtime.gateway';
import { CreateNotificationDto } from './dto/create-notification.dto';
import { NotificationPreferenceDto } from './dto/set-notification-preferences.dto';
import { isNotificationType, NOTIFICATION_TYPES } from './notification-types';

@Injectable()
export class NotificationsService {
  constructor(
    private readonly database: DatabaseService,
    private readonly realtime: RealtimeGateway,
  ) {}

  // Each recipient who turned this type off is left out; with nobody left,
  // nothing is written (null).
  async create(dto: CreateNotificationDto) {
    const { recipientIds: addressed, ...data } = dto;
    const recipientIds = await this.wantedBy(addressed, dto.type);
    if (recipientIds.length === 0) return null;
    const notification = await this.database.notification.create({
      data: {
        ...data,
        recipients: {
          createMany: {
            data: recipientIds.map((userId) => ({ userId })),
          },
        },
      },
      include: { recipients: true },
    });
    // Every notification (courriers, tasks, manual) goes through here, so
    // this is the single place the bell gets pushed.
    this.realtime.emitToUsers(recipientIds, 'notification:new', {
      id: notification.id,
    });
    return notification;
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
  findMine(userId: string, status?: NotificationStatus) {
    const where: Prisma.UserNotificationWhereInput = { userId, status };
    return this.database.userNotification.findMany({
      where,
      include: { notification: true },
      orderBy: { notification: { createdAt: 'desc' } },
    });
  }

  async markStatus(id: string, userId: string, status: NotificationStatus) {
    const link = await this.database.userNotification.findUnique({
      where: { userId_notificationId: { userId, notificationId: id } },
    });
    if (!link) {
      throw new NotFoundException(`Notification ${id} not found for this user`);
    }
    return this.database.userNotification.update({
      where: { userId_notificationId: { userId, notificationId: id } },
      data: { status },
      include: { notification: true },
    });
  }
}
