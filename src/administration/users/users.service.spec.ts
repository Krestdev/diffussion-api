import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { RbacService } from '../../auth/rbac/rbac.service';
import { DatabaseService } from '../../database/database.service';
import { NotificationsService } from '../../notifications/notifications.service';
import { RealtimeGateway } from '../../realtime/realtime.gateway';
import { AppAccessService } from '../../core/app-access.service';
import { UsersService } from './users.service';
import { ActivityService } from '../../activity/activity.service';

describe('UsersService', () => {
  let service: UsersService;
  let database: {
    user: Record<string, jest.Mock>;
    role: Record<string, jest.Mock>;
    site: Record<string, jest.Mock>;
    userRole: Record<string, jest.Mock>;
    $transaction: jest.Mock;
  };
  let rbac: {
    administeredSites: jest.Mock;
    withAdminCoverage: jest.Mock;
    hasGlobalPermission: jest.Mock;
  };

  beforeEach(async () => {
    database = {
      user: {
        findUnique: jest.fn().mockResolvedValue(null),
        create: jest
          .fn()
          .mockResolvedValue({ id: 'u-new', userRoles: [], site: null }),
        update: jest
          .fn()
          .mockResolvedValue({ id: 'u-2', userRoles: [], site: null }),
        findMany: jest.fn(),
        count: jest.fn(),
      },
      role: {
        findMany: jest
          .fn()
          .mockImplementation(
            ({ where }: { where: { id: { in: string[] } } }) =>
              Promise.resolve(
                // Global roles unless a test says otherwise.
                where.id.in.map((id) => ({ id, name: id, siteId: null })),
              ),
          ),
      },
      site: {
        findUnique: jest
          .fn()
          .mockResolvedValue({ name: 'Cristal', status: 'ACTIVE' }),
        // Not a site responsible unless a test says otherwise.
        findFirst: jest.fn().mockResolvedValue(null),
      },
      userRole: { findMany: jest.fn().mockResolvedValue([]) },
      $transaction: jest.fn().mockResolvedValue([[], 0]),
    };
    rbac = {
      // The responsible of site s-1 unless a test says otherwise.
      administeredSites: jest.fn().mockResolvedValue(['s-1']),
      hasGlobalPermission: jest.fn().mockResolvedValue(false),
      withAdminCoverage: jest.fn((change: (tx: unknown) => unknown) =>
        change(database),
      ),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UsersService,
        {
          provide: ActivityService,
          useValue: { tryRecord: jest.fn().mockResolvedValue(null) },
        },
        { provide: DatabaseService, useValue: database },
        {
          provide: AppAccessService,
          useValue: { refresh: jest.fn() },
        },
        {
          provide: RealtimeGateway,
          useValue: { emitToUsers: jest.fn(), broadcast: jest.fn() },
        },
        { provide: RbacService, useValue: rbac },
        {
          provide: NotificationsService,
          useValue: { notifyAccessChanged: jest.fn() },
        },
      ],
    }).compile();

    service = module.get<UsersService>(UsersService);
  });

  it('refuses someone who administers nothing', async () => {
    rbac.administeredSites.mockResolvedValue([]);

    await expect(service.findAll({}, 'nobody')).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  describe("site responsible (the site's administrator)", () => {
    it('gives a user of their site roles held there', async () => {
      database.user.findUnique.mockResolvedValue({ id: 'u-2', siteId: 's-1' });

      await service.update('u-2', { roleIds: ['r-1'] }, 'admin-s1');

      const { data } = database.user.update.mock.calls[0][0] as {
        data: { userRoles: { create: unknown } };
      };
      expect(data.userRoles.create).toEqual([{ roleId: 'r-1', siteId: 's-1' }]);
    });

    it("can't give a user another site's role", async () => {
      database.user.findUnique.mockResolvedValue({ id: 'u-2', siteId: 's-1' });
      database.role.findMany.mockResolvedValue([
        { id: 'r-2', name: 'Agent Akwa', siteId: 's-2' },
      ]);

      await expect(
        service.update('u-2', { roleIds: ['r-2'] }, 'admin-s1'),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(database.user.update).not.toHaveBeenCalled();
    });

    it('only lists the users of their site', async () => {
      await service.findAll({}, 'admin-s1');

      expect(database.user.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            AND: [{ siteId: { in: ['s-1'] } }, {}],
          }) as unknown,
        }),
      );
    });

    it.each([
      ['another site', 's-2'],
      ['a platform user', null],
    ])('cannot touch a user of %s', async (_label, siteId) => {
      database.user.findUnique.mockResolvedValue({
        id: 'u-2',
        siteId,
        status: 'ACTIVE',
        userRoles: [],
        site: null,
      });

      await expect(service.findOne('u-2', 'admin-s1')).rejects.toBeInstanceOf(
        ForbiddenException,
      );
      await expect(
        service.update('u-2', { roleIds: [] }, 'admin-s1'),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(database.user.update).not.toHaveBeenCalled();
    });
  });

  describe('platform administrator', () => {
    beforeEach(() => rbac.administeredSites.mockResolvedValue('ALL'));

    it('keeps a global grant still listed instead of tying it to the site', async () => {
      database.user.findUnique.mockResolvedValue({ id: 'u-2', siteId: 's-1' });
      database.userRole.findMany.mockImplementation(
        ({ where }: { where: { siteId?: null } }) =>
          Promise.resolve(where.siteId === null ? [{ roleId: 'r-g' }] : []),
      );

      await service.update('u-2', { roleIds: ['r-g', 'r-1'] }, 'super-admin');

      const { data } = database.user.update.mock.calls[0][0] as {
        data: { userRoles: { deleteMany: unknown; create: unknown } };
      };
      expect(data.userRoles.deleteMany).toEqual({
        NOT: { siteId: null, roleId: { in: ['r-g'] } },
      });
      expect(data.userRoles.create).toEqual([{ roleId: 'r-1', siteId: 's-1' }]);
    });
  });

  describe('directory (the people pickers)', () => {
    const findArgs = () =>
      database.user.findMany.mock.calls[0][0] as {
        where: Record<string, unknown>;
      };

    beforeEach(() => {
      database.user.findMany.mockResolvedValue([]);
      // A chef de projet of site s-1: administers nothing.
      rbac.administeredSites.mockResolvedValue([]);
      database.user.findUnique.mockResolvedValue({ siteId: 's-1' });
    });

    it("gives anyone their own site's active people", async () => {
      await service.directory({}, 'u-chef');

      expect(findArgs().where).toMatchObject({
        status: 'ACTIVE',
        siteId: 's-1',
      });
    });

    it("gives nothing of another site's", async () => {
      const res = await service.directory({ siteId: 's-2' }, 'u-chef');

      expect(res).toEqual([]);
      expect(database.user.findMany).not.toHaveBeenCalled();
    });

    it('filters on a permission held at the site or globally', async () => {
      await service.directory(
        { permission: 'ANALYSIS_DECIDE' as never },
        'u-chef',
      );

      expect(JSON.stringify(findArgs().where)).toContain('ANALYSIS_DECIDE');
    });

    it('resolves ids whatever their site', async () => {
      await service.directory({ ids: ['u-9'] }, 'u-chef');

      expect(findArgs().where).toEqual({ id: { in: ['u-9'] } });
    });

    it('lets a platform administrator pick any site', async () => {
      rbac.hasGlobalPermission.mockResolvedValue(true);

      await service.directory({ siteId: 's-2' }, 'super-admin');

      expect(findArgs().where).toMatchObject({ siteId: 's-2' });
    });
  });
});
