import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { NotificationsService } from './notifications.service';
import { DatabaseService } from '../database/database.service';
import { NotificationStatus } from '../../generated/prisma/client';

describe('NotificationsService', () => {
  let service: NotificationsService;
  let database: {
    notification: Record<string, jest.Mock>;
    userNotification: Record<string, jest.Mock>;
  };

  beforeEach(async () => {
    database = {
      notification: { create: jest.fn() },
      userNotification: {
        findMany: jest.fn(),
        findUnique: jest.fn(),
        update: jest.fn(),
      },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        NotificationsService,
        { provide: DatabaseService, useValue: database },
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

  describe('markStatus', () => {
    it('throws when the user was not a recipient', async () => {
      database.userNotification.findUnique.mockResolvedValue(null);

      await expect(
        service.markStatus('n-1', 'u-1', NotificationStatus.READ),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });
});
