import { Test, TestingModule } from '@nestjs/testing';
import { DatabaseService } from '../../database/database.service';
import { PermissionCode } from './rbac.constants';
import { RbacService } from './rbac.service';

describe("RbacService: a site's responsible", () => {
  let service: RbacService;
  let database: {
    userRole: { findMany: jest.Mock };
    delegation: { findMany: jest.Mock };
    site: { count: jest.Mock; findMany: jest.Mock };
  };

  beforeEach(async () => {
    database = {
      userRole: { findMany: jest.fn().mockResolvedValue([]) },
      delegation: { findMany: jest.fn().mockResolvedValue([]) },
      site: {
        // Responsible of s-1 and nothing else.
        count: jest.fn(({ where }: { where: { id?: string } }) =>
          Promise.resolve(!where.id || where.id === 's-1' ? 1 : 0),
        ),
        findMany: jest.fn().mockResolvedValue([{ id: 's-1' }]),
      },
    };
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RbacService,
        { provide: DatabaseService, useValue: database },
      ],
    }).compile();
    service = module.get(RbacService);
  });

  it('holds the permissions at their site, without any role', async () => {
    await expect(
      service.hasPermissionAtSite('u-1', PermissionCode.UsersRead, 's-1'),
    ).resolves.toBe(true);
  });

  it('holds nothing at another site', async () => {
    await expect(
      service.hasPermissionAtSite('u-1', PermissionCode.UsersRead, 's-2'),
    ).resolves.toBe(false);
  });

  it("doesn't get the platform's own permissions", async () => {
    const codes = await service.getPermissionCodes('u-1', 's-1');

    expect(codes).not.toContain(PermissionCode.DashboardGlobalRead);
    expect(codes).not.toContain(PermissionCode.AdminManageCategories);
    expect(codes).not.toContain(PermissionCode.AdminManageSites);
  });

  it('includes the reading of what a role lets them manage', async () => {
    database.site.count.mockResolvedValue(0);
    database.userRole.findMany.mockResolvedValue([
      {
        role: {
          rolePermissions: [
            { permission: { code: PermissionCode.AdminManageRoles } },
          ],
        },
      },
    ]);

    const codes = await service.getPermissionCodes('u-2');

    expect(codes).toContain(PermissionCode.RolesRead);
    expect(codes).not.toContain(PermissionCode.SettingsRead);
  });

  it('lists only their site for a list filter', async () => {
    await expect(
      service.sitesWithPermission('u-1', PermissionCode.CourrierRead),
    ).resolves.toEqual(['s-1']);
  });
});

describe('RbacService.resolveSiteId', () => {
  let service: RbacService;
  let database: {
    courrier: { findUnique: jest.Mock };
    instruction: { findUnique: jest.Mock };
  };

  beforeEach(async () => {
    database = {
      courrier: { findUnique: jest.fn() },
      instruction: { findUnique: jest.fn() },
    };
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RbacService,
        { provide: DatabaseService, useValue: database },
      ],
    }).compile();
    service = module.get(RbacService);
  });

  describe('an effet', () => {
    it("is its dossier's site", async () => {
      database.courrier.findUnique.mockResolvedValue({
        dossier: { siteId: 's-dossier' },
        createdBy: { siteId: 's-registrant' },
      });

      await expect(service.resolveSiteId('courrier', 'c-1')).resolves.toBe(
        's-dossier',
      );
    });

    it("without a dossier, is its registrant's site — never no site", async () => {
      database.courrier.findUnique.mockResolvedValue({
        dossier: null,
        createdBy: { siteId: 's-registrant' },
      });

      await expect(service.resolveSiteId('courrier', 'c-1')).resolves.toBe(
        's-registrant',
      );
    });
  });

  describe('a task', () => {
    it("without a dossier, is its effet's site", async () => {
      database.instruction.findUnique.mockResolvedValue({
        dossier: null,
        courrier: { dossier: null, createdBy: { siteId: 's-effet' } },
        contract: { project: { siteId: 's-project' } },
      });

      await expect(service.resolveSiteId('instruction', 'i-1')).resolves.toBe(
        's-effet',
      );
    });

    it("on a contract only, is its contract's project's site", async () => {
      database.instruction.findUnique.mockResolvedValue({
        dossier: null,
        courrier: null,
        contract: { project: { siteId: 's-project' } },
      });

      await expect(service.resolveSiteId('instruction', 'i-1')).resolves.toBe(
        's-project',
      );
    });
  });
});
