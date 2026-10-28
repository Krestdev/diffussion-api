import { Test, TestingModule } from '@nestjs/testing';
import { PermissionGuard } from '../auth/rbac/permission.guard';
import {
  PERMISSION_METADATA_KEY,
  PermissionCode,
} from '../auth/rbac/rbac.constants';
import { PLATFORM_ONLY_METADATA_KEY } from '../auth/rbac/require-permission.decorator';
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

  it('reserves posting a notification to platform administrators', () => {
    const handler = Object.getOwnPropertyDescriptor(
      NotificationsController.prototype,
      'create',
    )!.value as object;
    expect(Reflect.getMetadata(PERMISSION_METADATA_KEY, handler)).toBe(
      PermissionCode.AdminManageUsers,
    );
    expect(Reflect.getMetadata(PLATFORM_ONLY_METADATA_KEY, handler)).toBe(true);
  });

  it('leaves the inbox routes open to every user', () => {
    for (const route of ['findMine', 'markRead', 'archive'] as const) {
      const handler = Object.getOwnPropertyDescriptor(
        NotificationsController.prototype,
        route,
      )!.value as object;
      expect(
        Reflect.getMetadata(PERMISSION_METADATA_KEY, handler),
      ).toBeUndefined();
    }
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
