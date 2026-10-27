import { Test, TestingModule } from '@nestjs/testing';
import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { RbacService } from '../../auth/rbac/rbac.service';
import { DatabaseService } from '../../database/database.service';
import { RoleService } from './role.service';

const ROLE_VIEW = { id: 'r-new', rolePermissions: [], userRoles: [] };

describe('RoleService', () => {
  let service: RoleService;
  let database: {
    role: Record<string, jest.Mock>;
    permission: Record<string, jest.Mock>;
    user: Record<string, jest.Mock>;
    userRole: Record<string, jest.Mock>;
    rolePermission: Record<string, jest.Mock>;
    $transaction: jest.Mock;
  };
  let rbac: {
    administeredSites: jest.Mock;
    hasGlobalPermission: jest.Mock;
    withAdminCoverage: jest.Mock;
  };

  const createdData = () =>
    (database.role.create.mock.calls[0][0] as { data: { siteId: unknown } })
      .data;

  beforeEach(async () => {
    database = {
      role: {
        create: jest.fn().mockResolvedValue(ROLE_VIEW),
        findFirst: jest.fn().mockResolvedValue(null),
        findUnique: jest.fn(),
        findMany: jest.fn(),
        count: jest.fn(),
        update: jest.fn().mockResolvedValue(ROLE_VIEW),
        delete: jest.fn(),
      },
      permission: {
        findMany: jest
          .fn()
          .mockImplementation(
            ({ where }: { where: { id: { in: string[] } } }) =>
              Promise.resolve(
                [
                  { id: 'p-register', code: 'COURRIER_REGISTER_ENTRANT' },
                  { id: 'p-roles', code: 'ADMIN_MANAGE_ROLES' },
                ].filter((permission) => where.id.in.includes(permission.id)),
              ),
          ),
      },
      user: { findUnique: jest.fn().mockResolvedValue({ siteId: 's-1' }) },
      userRole: { findMany: jest.fn().mockResolvedValue([]) },
      rolePermission: { deleteMany: jest.fn() },
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
        RoleService,
        { provide: DatabaseService, useValue: database },
        { provide: RbacService, useValue: rbac },
      ],
    }).compile();

    service = module.get<RoleService>(RoleService);
  });

  describe("site responsible (the site's administrator)", () => {
    it('creates roles for their own site', async () => {
      await service.create(
        { name: 'Agent courrier', permissionIds: ['p-register'] },
        'resp-s1',
      );

      expect(createdData().siteId).toBe('s-1');
    });

    it('cannot create a role for another site', async () => {
      await expect(
        service.create({ name: 'Agent', siteId: 's-2' }, 'resp-s1'),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(database.role.create).not.toHaveBeenCalled();
    });

    it("can't put platform permissions in a site role", async () => {
      await expect(
        service.create(
          { name: 'Super', permissionIds: ['p-roles'] },
          'resp-s1',
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it.each([
      ['a global role', null],
      ["another site's role", 's-2'],
    ])('cannot change or delete %s', async (_label, siteId) => {
      database.role.findUnique.mockResolvedValue({ id: 'r-1', siteId });

      await expect(
        service.update('r-1', { name: 'X' }, 'resp-s1'),
      ).rejects.toBeInstanceOf(ForbiddenException);
      await expect(service.remove('r-1', 'resp-s1')).rejects.toBeInstanceOf(
        ForbiddenException,
      );
    });

    it('sees the global roles and their own site’s', async () => {
      database.role.findFirst.mockResolvedValue(null);

      await expect(
        service.findOne('r-other', 'resp-s1'),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(database.role.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            id: 'r-other',
            AND: [{ OR: [{ siteId: null }, { siteId: 's-1' }] }],
          },
        }),
      );
    });
  });

  it('refuses someone who administers nothing', async () => {
    rbac.administeredSites.mockResolvedValue([]);

    await expect(
      service.create({ name: 'Agent' }, 'nobody'),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  describe('platform administrator', () => {
    beforeEach(() => {
      rbac.administeredSites.mockResolvedValue('ALL');
      rbac.hasGlobalPermission.mockResolvedValue(true);
    });

    it('creates global roles by default', async () => {
      await service.create(
        { name: 'Administrateur bis', permissionIds: ['p-roles'] },
        'super-admin',
      );

      expect(createdData().siteId).toBeNull();
    });

    it('can make a role for a site', async () => {
      await service.create({ name: 'Agent', siteId: 's-2' }, 'super-admin');

      expect(createdData().siteId).toBe('s-2');
    });
  });
});
