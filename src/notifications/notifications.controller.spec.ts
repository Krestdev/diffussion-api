import { Test, TestingModule } from '@nestjs/testing';
import { PermissionGuard } from '../auth/rbac/permission.guard';
import { NotificationsController } from './notifications.controller';
import { NotificationsService } from './notifications.service';
import { NotificationStatus } from '../../generated/prisma/client';

describe('NotificationsController', () => {
  let controller: NotificationsController;
  let service: Record<string, jest.Mock>;

  beforeEach(async () => {
    service = { create: jest.fn(), findMine: jest.fn(), markStatus: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [NotificationsController],
      providers: [{ provide: NotificationsService, useValue: service }],
    })
      .overrideGuard(PermissionGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = module.get<NotificationsController>(NotificationsController);
  });

  it('is defined', () => {
    expect(controller).toBeDefined();
  });

  it('markRead() marks the current user’s copy as READ', () => {
    controller.markRead('n-1', {
      sub: 'u-1',
      email: 'u@x.com',
      refreshToken: 'r',
    });
    expect(service.markStatus).toHaveBeenCalledWith(
      'n-1',
      'u-1',
      NotificationStatus.READ,
    );
  });
});
