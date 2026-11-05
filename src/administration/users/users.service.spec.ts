import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { RbacService } from '../../auth/rbac/rbac.service';
import { DatabaseService } from '../../database/database.service';
import { RealtimeGateway } from '../../realtime/realtime.gateway';
import { MailerService } from '../../mail/mailer.service';
import { UsersService } from './users.service';

const NEW_USER = {
  name: 'Paul',
  email: 'paul@example.com',
  password: 'Str0ngP@ssword',
};

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

  const created = () =>
    database.user.create.mock.calls[0][0] as {
      data: {
        siteId: string | null;
        userRoles?: { create: { roleId: string; siteId: string | null }[] };
      };
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
        { provide: DatabaseService, useValue: database },
        {
          provide: MailerService,
          useValue: { sendInvitation: jest.fn() },
        },
        {
          provide: RealtimeGateway,
          useValue: { emitToUsers: jest.fn(), broadcast: jest.fn() },
        },
        { provide: RbacService, useValue: rbac },
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
    it('creates users in their own site, with the roles held there', async () => {
      await service.create({ ...NEW_USER, roleIds: ['r-1'] }, 'admin-s1');

      expect(created().data.siteId).toBe('s-1');
      expect(created().data.userRoles?.create).toEqual([
        { roleId: 'r-1', siteId: 's-1' },
      ]);
    });

    it("can't give a user another site's role", async () => {
      database.role.findMany.mockResolvedValue([
        { id: 'r-2', name: 'Agent Akwa', siteId: 's-2' },
      ]);

      await expect(
        service.create({ ...NEW_USER, roleIds: ['r-2'] }, 'admin-s1'),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(database.user.create).not.toHaveBeenCalled();
    });

    it('cannot create a user in another site', async () => {
      await expect(
        service.create({ ...NEW_USER, siteId: 's-2' }, 'admin-s1'),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(database.user.create).not.toHaveBeenCalled();
    });

    it('cannot create a platform user (global roles)', async () => {
      await expect(
        service.create({ ...NEW_USER, siteId: null }, 'admin-s1'),
      ).rejects.toBeInstanceOf(ForbiddenException);
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
        service.update('u-2', { name: 'X' }, 'admin-s1'),
      ).rejects.toBeInstanceOf(ForbiddenException);
      await expect(
        service.toggleStatus('u-2', 'admin-s1'),
      ).rejects.toBeInstanceOf(ForbiddenException);
      await expect(service.remove('u-2', 'admin-s1')).rejects.toBeInstanceOf(
        ForbiddenException,
      );
      expect(database.user.update).not.toHaveBeenCalled();
    });

    it('cannot move one of their users to another site', async () => {
      database.user.findUnique.mockResolvedValue({ id: 'u-2', siteId: 's-1' });

      await expect(
        service.update('u-2', { siteId: 's-2' }, 'admin-s1'),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });
  });

  describe('platform administrator', () => {
    beforeEach(() => rbac.administeredSites.mockResolvedValue('ALL'));

    it('must say which site a new user belongs to', async () => {
      await expect(
        service.create(NEW_USER, 'super-admin'),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('creates a platform user with global roles', async () => {
      await service.create(
        { ...NEW_USER, siteId: null, roleIds: ['r-admin'] },
        'super-admin',
      );

      expect(created().data.siteId).toBeNull();
      expect(created().data.userRoles?.create).toEqual([
        { roleId: 'r-admin', siteId: null },
      ]);
    });

    it("moves a user's roles along when moving them to another site", async () => {
      database.user.findUnique.mockResolvedValue({ id: 'u-2', siteId: 's-1' });
      database.userRole.findMany.mockResolvedValue([{ roleId: 'r-1' }]);

      await service.update('u-2', { siteId: 's-2' }, 'super-admin');

      const { data } = database.user.update.mock.calls[0][0] as {
        data: { siteId: string; userRoles: { create: unknown } };
      };
      expect(data.siteId).toBe('s-2');
      expect(data.userRoles.create).toEqual([{ roleId: 'r-1', siteId: 's-2' }]);
    });

    it("won't suspend a site's responsible", async () => {
      database.user.findUnique.mockResolvedValue({
        id: 'u-2',
        siteId: 's-1',
        status: 'ACTIVE',
      });
      database.site.findFirst.mockResolvedValue({ name: 'Cristal' });

      await expect(service.toggleStatus('u-2', 'super-admin')).rejects.toThrow(
        /responsible of site "Cristal"/,
      );
      expect(database.user.update).not.toHaveBeenCalled();
    });

    it('reactivates a suspended user without that check', async () => {
      database.user.findUnique.mockResolvedValue({
        id: 'u-2',
        siteId: 's-1',
        status: 'SUSPENDED',
      });

      await service.toggleStatus('u-2', 'super-admin');

      expect(database.site.findFirst).not.toHaveBeenCalled();
      expect(database.user.update).toHaveBeenCalled();
    });

    it("won't move a site's responsible out of their site", async () => {
      database.user.findUnique.mockResolvedValue({ id: 'u-2', siteId: 's-1' });
      database.site.findFirst.mockResolvedValue({ name: 'Cristal' });

      await expect(
        service.update('u-2', { siteId: 's-2' }, 'super-admin'),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(database.user.update).not.toHaveBeenCalled();
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
