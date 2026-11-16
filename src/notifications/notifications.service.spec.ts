import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { NotificationsService } from './notifications.service';
import { DatabaseService } from '../database/database.service';
import { RealtimeGateway } from '../realtime/realtime.gateway';
import { ModuleNotificationsService } from '../administration/settings/module-notifications.service';
import { NotificationStatus, Prisma } from '../generated/prisma/client';

/** What notification.create gives back, for `userIds`. */
const created = (userIds: string[], type = 'TASK_ASSIGNED') => ({
  id: 'n-1',
  type,
  recipients: userIds.map((userId) => ({
    userId,
    notificationId: 'n-1',
    status: 'NOT_READ',
  })),
  courrier: null,
});

describe('NotificationsService', () => {
  let service: NotificationsService;
  let database: {
    notification: Record<string, jest.Mock>;
    courrier: Record<string, jest.Mock>;
    instruction: Record<string, jest.Mock>;
    userNotification: Record<string, jest.Mock>;
    notificationPreference: Record<string, jest.Mock>;
    $transaction: jest.Mock;
  };
  let realtime: {
    emitToUsers: jest.Mock;
    broadcast: jest.Mock;
    toUser: jest.Mock;
    accessChanged: jest.Mock;
  };
  // Every recipient's company shows every event, unless a test says otherwise.
  let moduleNotifications: { inAppRecipients: jest.Mock };

  beforeEach(async () => {
    moduleNotifications = {
      inAppRecipients: jest.fn((ids: string[]) => Promise.resolve(ids)),
    };
    database = {
      notification: { create: jest.fn() },
      courrier: { findUnique: jest.fn().mockResolvedValue(null) },
      instruction: { findUnique: jest.fn().mockResolvedValue(null) },
      userNotification: {
        findMany: jest.fn(),
        findUnique: jest.fn(),
        update: jest.fn(),
        updateMany: jest.fn(),
      },
      notificationPreference: {
        findMany: jest.fn().mockResolvedValue([]),
        upsert: jest.fn(),
      },
      $transaction: jest.fn((ops: unknown[]) => Promise.all(ops)),
    };
    realtime = {
      emitToUsers: jest.fn(),
      broadcast: jest.fn(),
      toUser: jest.fn(),
      accessChanged: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        NotificationsService,
        { provide: DatabaseService, useValue: database },
        { provide: RealtimeGateway, useValue: realtime },
        { provide: ModuleNotificationsService, useValue: moduleNotifications },
      ],
    }).compile();

    service = module.get<NotificationsService>(NotificationsService);
  });

  it('is defined', () => {
    expect(service).toBeDefined();
  });

  it('leaves out the recipients whose company turned the event off (PA·9)', async () => {
    moduleNotifications.inAppRecipients.mockResolvedValue([]);

    const res = await service.create({
      recipientIds: ['u-1', 'u-2'],
      type: 'TASK_ASSIGNED',
      message: 'x',
      canal: 'IN_APP',
    } as never);

    expect(res).toBeNull();
    expect(database.notification.create).not.toHaveBeenCalled();
  });

  it('fans out to every recipient (RG-NOT-003)', async () => {
    database.notification.create.mockResolvedValue(created(['u-1']));

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

  describe('texts and live push', () => {
    it("keeps the params of the texts: the effet's number and subject, the task's title, then the caller's", async () => {
      database.courrier.findUnique.mockResolvedValue({
        number: 'EE-0001',
        subject: 'Facture',
      });
      database.instruction.findUnique.mockResolvedValue({
        title: 'Analyser',
        number: 'IN-0001',
      });
      database.notification.create.mockResolvedValue(created(['u-1']));

      await service.create({
        recipientIds: ['u-1'],
        type: 'TASK_LIVRABLE_REJECTED',
        canal: 'IN_APP',
        courrierId: 'c-1',
        instructionId: 'i-1',
        params: { reason: 'Incomplet', livrable: 'Rapport' },
      });

      expect(database.notification.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            params: {
              number: 'EE-0001',
              subject: 'Facture',
              title: 'Analyser',
              taskNumber: 'IN-0001',
              reason: 'Incomplet',
              livrable: 'Rapport',
            },
          }),
        }),
      );
    });

    it('stores no params for an announcement without any', async () => {
      database.notification.create.mockResolvedValue(
        created(['u-1'], 'ANNOUNCEMENT'),
      );

      await service.create({
        recipientIds: ['u-1'],
        type: 'ANNOUNCEMENT',
        message: 'Maintenance ce soir',
        canal: 'IN_APP',
      });

      const call = database.notification.create.mock.calls[0] as [
        { data: Record<string, unknown> },
      ];
      expect(call[0].data).not.toHaveProperty('params');
    });

    it('creates a notification once per source (a repeated reminder run sends nothing)', async () => {
      database.notification.create.mockRejectedValue(
        new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
          code: 'P2002',
          clientVersion: 'test',
        }),
      );

      const result = await service.create(
        { recipientIds: ['u-1'], type: 'DAILY_DIGEST', canal: 'IN_APP' },
        'digest:2026-11-16:u-1',
      );

      expect(result).toBeNull();
      expect(database.notification.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ sourceKey: 'digest:2026-11-16:u-1' }),
        }),
      );
      expect(realtime.toUser).not.toHaveBeenCalled();
    });

    it("tells the people whose access changed to reload their rights, the author's included", async () => {
      database.notification.create.mockResolvedValue(
        created(['u-2'], 'ACCESS_CHANGED'),
      );

      await service.notifyAccessChanged(['u-1', 'u-2'], 'u-1', 'Rôle attribué');

      expect(realtime.accessChanged).toHaveBeenCalledWith(['u-1', 'u-2']);
      expect(realtime.toUser).toHaveBeenCalledWith(
        'u-2',
        'notification',
        expect.anything(),
      );
    });
  });

  describe('preferences', () => {
    it('leaves out the recipients who turned the type off', async () => {
      database.notificationPreference.findMany.mockResolvedValue([
        { userId: 'u-2' },
      ]);
      database.notification.create.mockResolvedValue(created(['u-1']));

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
      expect(realtime.toUser).toHaveBeenCalledTimes(1);
      expect(realtime.toUser).toHaveBeenCalledWith(
        'u-1',
        'notification',
        expect.objectContaining({
          userId: 'u-1',
          notificationId: 'n-1',
          status: 'NOT_READ',
          notification: expect.objectContaining({
            id: 'n-1',
            type: 'TASK_ASSIGNED',
            courrierDirection: null,
          }),
        }),
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
      expect(realtime.toUser).not.toHaveBeenCalled();
    });

    it('always delivers a type outside the catalog (announcements)', async () => {
      database.notification.create.mockResolvedValue(created(['u-1']));

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

  describe('the inbox', () => {
    it("gives each notification its effet's direction", async () => {
      database.userNotification.findMany.mockResolvedValue([
        {
          userId: 'u-1',
          status: NotificationStatus.NOT_READ,
          notification: {
            id: 'n-1',
            courrierId: 'c-1',
            courrier: { direction: 'SORTANT' },
          },
        },
        {
          userId: 'u-1',
          status: NotificationStatus.NOT_READ,
          notification: { id: 'n-2', courrierId: null, courrier: null },
        },
      ]);

      const [withEffet, without] = await service.findMine('u-1');

      expect(withEffet.notification).toEqual({
        id: 'n-1',
        courrierId: 'c-1',
        courrierDirection: 'SORTANT',
      });
      expect(without.notification.courrierDirection).toBeNull();
    });

    it("marks only the user's unread notifications as read", async () => {
      database.userNotification.updateMany.mockResolvedValue({ count: 3 });

      await expect(service.markAllRead('u-1')).resolves.toEqual({ count: 3 });

      expect(database.userNotification.updateMany).toHaveBeenCalledWith({
        where: { userId: 'u-1', status: NotificationStatus.NOT_READ },
        data: { status: NotificationStatus.READ },
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
