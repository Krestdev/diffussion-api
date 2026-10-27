import { Injectable, NotFoundException } from '@nestjs/common';
import { NotificationStatus, Prisma } from '../../generated/prisma/client';
import { DatabaseService } from '../database/database.service';
import { RealtimeGateway } from '../realtime/realtime.gateway';
import { CreateNotificationDto } from './dto/create-notification.dto';

@Injectable()
export class NotificationsService {
  constructor(
    private readonly database: DatabaseService,
    private readonly realtime: RealtimeGateway,
  ) {}

  async create(dto: CreateNotificationDto) {
    const { recipientIds, ...data } = dto;
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
