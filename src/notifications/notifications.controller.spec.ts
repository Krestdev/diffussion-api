import { CoreAuthGuard } from '../auth/guards/core-auth.guard';
import { Test, TestingModule } from '@nestjs/testing';
import { PermissionsGuard } from '../auth/access/permissions.guard';
import { Permission } from '../auth/permissions';
import { PERMISSIONS_KEY, PLATFORM_ADMIN_KEY } from '../auth/access/decorators';
import { NotificationsController } from './notifications.controller';
import { NotificationsService } from './notifications.service';
import { NotificationStatus } from '../../generated/prisma/client';

describe('NotificationsController', () => {
  let controller: NotificationsController;
  let service: Record<string, jest.Mock>;

  beforeEach(async () => {
    service = {
      create: jest.fn(),
      findMine: jest.fn(),
      markStatus: jest.fn(),
      markAllRead: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [NotificationsController],
      providers: [{ provide: NotificationsService, useValue: service }],
    })
      .overrideGuard(PermissionsGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(CoreAuthGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = module.get<NotificationsController>(NotificationsController);
  });

  it('is defined', () => {
    expect(controller).toBeDefined();
  });

  it('reserves posting a notification to platform administrators', () => {
    const handler = Object.getOwnPropertyDescriptor(
      NotificationsController.prototype,
      'create',
    )!.value as object;
    expect(Reflect.getMetadata(PERMISSIONS_KEY, handler)).toEqual([
      Permission.ROLE_ASSIGN,
    ]);
    expect(Reflect.getMetadata(PLATFORM_ADMIN_KEY, handler)).toBe(true);
  });

  it('leaves the inbox routes open to every user', () => {
    for (const route of [
      'findMine',
      'markRead',
      'markAllRead',
      'archive',
    ] as const) {
      const handler = Object.getOwnPropertyDescriptor(
        NotificationsController.prototype,
        route,
      )!.value as object;
      expect(Reflect.getMetadata(PERMISSIONS_KEY, handler)).toBeUndefined();
    }
  });

  it('markRead() marks the current user’s copy as READ', () => {
    controller.markRead('n-1', {
      sub: 'u-1',
      email: 'u@x.com',
      name: 'U',
      companyId: 's-1',
      sid: 'sid-1',
      impersonator: null,
      permissions: new Set<string>(),
      platformAdmin: false,
    });
    expect(service.markStatus).toHaveBeenCalledWith(
      'n-1',
      'u-1',
      NotificationStatus.READ,
    );
  });
});
