import { ForbiddenException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { ActivityService } from '../../activity/activity.service';
import {
  accessMock,
  AccessMock,
} from '../../activity/access-mock.testing-spec';
import { AccessService } from '../../auth/access/access.service';
import { Permission } from '../../auth/permissions';
import { DatabaseService } from '../../database/database.service';
import { NotificationsService } from '../../notifications/notifications.service';
import { RealtimeGateway } from '../../realtime/realtime.gateway';
import { RoleService } from '../role/role.service';
import { UsersService } from './users.service';

describe('UsersService', () => {
  let service: UsersService;
  let access: AccessMock;
  let roles: { setUserRoles: jest.Mock };
  let database: {
    user: Record<string, jest.Mock>;
    userRole: Record<string, jest.Mock>;
    $transaction: jest.Mock;
  };

  beforeEach(async () => {
    access = accessMock({
      permissions: [Permission.USER_READ, Permission.ROLE_ASSIGN],
    });
    roles = { setUserRoles: jest.fn().mockResolvedValue({}) };
    database = {
      user: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'u-2',
          companyId: 's-1',
          accessProfile: 'USER',
        }),
        findUniqueOrThrow: jest.fn().mockResolvedValue({
          id: 'u-2',
          companyId: 's-1',
          userRoles: [],
        }),
        findMany: jest.fn().mockResolvedValue([]),
        update: jest.fn(),
        count: jest.fn(),
      },
      userRole: { findMany: jest.fn().mockResolvedValue([]) },
      $transaction: jest.fn().mockResolvedValue([[], 0]),
    };
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UsersService,
        { provide: DatabaseService, useValue: database },
        { provide: AccessService, useValue: access },
        { provide: RoleService, useValue: roles },
        {
          provide: ActivityService,
          useValue: { tryRecord: jest.fn().mockResolvedValue(null) },
        },
        {
          provide: RealtimeGateway,
          useValue: { emitToUsers: jest.fn(), broadcast: jest.fn() },
        },
        {
          provide: NotificationsService,
          useValue: { notifyAccessChanged: jest.fn() },
        },
      ],
    }).compile();
    service = module.get(UsersService);
  });

  it('refuses the list without user.read', async () => {
    access.state.permissions = [];
    await expect(service.findAll({}, 'u-1')).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it("only lists the person's company", async () => {
    await service.findAll({}, 'u-1');
    expect(database.user.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          AND: expect.arrayContaining([{ companyId: 's-1' }]) as unknown,
        }) as unknown,
      }),
    );
  });

  it('refuses someone of another company', async () => {
    database.user.findUnique.mockResolvedValue({ id: 'u-9', companyId: 's-2' });
    await expect(
      service.update('u-9', { roleIds: [] }, 'u-1'),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(roles.setUserRoles).not.toHaveBeenCalled();
  });

  it('gives roles through RoleService (G3, G4 there)', async () => {
    await service.update('u-2', { roleIds: ['r-1'] }, 'u-1');
    expect(roles.setUserRoles).toHaveBeenCalledWith('s-1', 'u-2', ['r-1']);
  });

  it('keeps SUPER_ADMIN to super-administrators', async () => {
    await expect(
      service.update('u-2', { accessProfile: 'SUPER_ADMIN' }, 'u-1'),
    ).rejects.toBeInstanceOf(ForbiddenException);
    access.state.platformAdmin = true;
    await service.update('u-2', { accessProfile: 'SUPER_ADMIN' }, 'u-1');
    expect(database.user.update).toHaveBeenCalledWith({
      where: { id: 'u-2' },
      data: { accessProfile: 'SUPER_ADMIN' },
    });
  });
});
