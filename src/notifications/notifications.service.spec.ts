import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { NotificationsService } from './notifications.service';
import { DatabaseService } from '../database/database.service';
import { RealtimeGateway } from '../realtime/realtime.gateway';
import { NotificationStatus } from '../../generated/prisma/client';

describe('NotificationsService', () => {
  let service: NotificationsService;
  let database: {
    notification: Record<string, jest.Mock>;
    userNotification: Record<string, jest.Mock>;
    notificationPreference: Record<string, jest.Mock>;
    $transaction: jest.Mock;
  };
  let realtime: { emitToUsers: jest.Mock; broadcast: jest.Mock };

  beforeEach(async () => {
    database = {
      notification: { create: jest.fn() },
      userNotification: {
        findMany: jest.fn(),
        findUnique: jest.fn(),
        update: jest.fn(),
      },
      notificationPreference: {
        findMany: jest.fn().mockResolvedValue([]),
        upsert: jest.fn(),
      },
      $transaction: jest.fn((ops: unknown[]) => Promise.all(ops)),
    };
    realtime = { emitToUsers: jest.fn(), broadcast: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        NotificationsService,
        { provide: DatabaseService, useValue: database },
        { provide: RealtimeGateway, useValue: realtime },
      ],
    }).compile();

    service = module.get<NotificationsService>(NotificationsService);
  });

  it('is defined', () => {
    expect(service).toBeDefined();
  });

  it('fans out to every recipient (RG-NOT-003)', async () => {
    database.notification.create.mockResolvedValue({ id: 'n-1' });

    await service.create({
      recipientIds: ['u-1', 'u-2'],
      type: 'INSTRUCTION_OVERDUE',
      canal: 'IN_APP',
    });

    expect(database.notification.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          recipients: {
            createMany: { data: [{ userId: 'u-1' }, { userId: 'u-2' }] },
          },
        }),
      }),
    );
  });

  describe('preferences', () => {
    it('leaves out the recipients who turned the type off', async () => {
      database.notificationPreference.findMany.mockResolvedValue([
        { userId: 'u-2' },
      ]);
      database.notification.create.mockResolvedValue({ id: 'n-1' });

      await service.create({
        recipientIds: ['u-1', 'u-2'],
        type: 'TASK_ASSIGNED',
        canal: 'IN_APP',
      });

      expect(database.notification.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            recipients: { createMany: { data: [{ userId: 'u-1' }] } },
          }),
        }),
      );
      expect(realtime.emitToUsers).toHaveBeenCalledWith(
        ['u-1'],
        'notification:new',
        { id: 'n-1' },
      );
    });

    it('writes nothing when every recipient turned the type off', async () => {
      database.notificationPreference.findMany.mockResolvedValue([
        { userId: 'u-1' },
      ]);

      const result = await service.create({
        recipientIds: ['u-1'],
        type: 'TASK_ASSIGNED',
        canal: 'IN_APP',
      });

      expect(result).toBeNull();
      expect(database.notification.create).not.toHaveBeenCalled();
      expect(realtime.emitToUsers).not.toHaveBeenCalled();
    });

    it('always delivers a type outside the catalog (announcements)', async () => {
      database.notification.create.mockResolvedValue({ id: 'n-1' });

      await service.create({
        recipientIds: ['u-1'],
        type: 'ANNOUNCEMENT',
        canal: 'IN_APP',
      });

      expect(database.notificationPreference.findMany).not.toHaveBeenCalled();
      expect(database.notification.create).toHaveBeenCalled();
    });

    it('lists every type, enabled unless turned off', async () => {
      database.notificationPreference.findMany.mockResolvedValue([
        { type: 'TASK_OVERDUE' },
      ]);

      const prefs = await service.getPreferences('u-1');

      expect(prefs.find((p) => p.type === 'TASK_OVERDUE')?.enabled).toBe(false);
      expect(prefs.find((p) => p.type === 'TASK_ASSIGNED')?.enabled).toBe(true);
      expect(prefs.every((p) => p.label.length > 0)).toBe(true);
    });

    it("saves the user's choices", async () => {
      await service.setPreferences('u-1', [
        { type: 'TASK_OVERDUE', enabled: false },
      ]);

      expect(database.notificationPreference.upsert).toHaveBeenCalledWith({
        where: { userId_type: { userId: 'u-1', type: 'TASK_OVERDUE' } },
        create: { userId: 'u-1', type: 'TASK_OVERDUE', enabled: false },
        update: { enabled: false },
      });
    });
  });

  describe('markStatus', () => {
    it('throws when the user was not a recipient', async () => {
      database.userNotification.findUnique.mockResolvedValue(null);

      await expect(
        service.markStatus('n-1', 'u-1', NotificationStatus.READ),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });
});
