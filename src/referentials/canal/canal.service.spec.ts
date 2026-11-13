import { ForbiddenException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { ActivityService } from '../../activity/activity.service';
import { RbacService } from '../../auth/rbac/rbac.service';
import { DatabaseService } from '../../database/database.service';
import { CanalService } from './canal.service';
import { withScopeChecks } from '../../auth/rbac/rbac.testing-spec';

describe('CanalService', () => {
  let service: CanalService;
  let database: {
    canal: Record<string, jest.Mock>;
    site: Record<string, jest.Mock>;
  };
  let rbac: { managedSites: jest.Mock };

  beforeEach(async () => {
    database = {
      canal: {
        create: jest.fn().mockResolvedValue({ id: 'k-new' }),
        findFirst: jest.fn().mockResolvedValue(null),
        update: jest.fn(),
      },
      site: { findUnique: jest.fn().mockResolvedValue({ id: 's-1' }) },
    };
    // ADMIN_MANAGE_REFERENTIALS held at site s-1 only.
    rbac = { managedSites: jest.fn().mockResolvedValue(['s-1']) };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CanalService,
        { provide: DatabaseService, useValue: database },
        { provide: ActivityService, useValue: { tryRecord: jest.fn() } },
        { provide: RbacService, useValue: withScopeChecks(rbac) },
      ],
    }).compile();

    service = module.get<CanalService>(CanalService);
  });

  it('lets whoever manages a site create its canaux', async () => {
    await service.create({ name: 'Coursier', siteId: 's-1' }, 'u-admin-s1');

    expect(rbac.managedSites).toHaveBeenCalledWith(
      'u-admin-s1',
      'ADMIN_MANAGE_REFERENTIALS',
    );
    expect(database.canal.create).toHaveBeenCalled();
  });

  it("refuses another site's", async () => {
    await expect(
      service.create({ name: 'Coursier', siteId: 's-2' }, 'u-admin-s1'),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(database.canal.create).not.toHaveBeenCalled();
  });

  it('refuses someone who manages no site', async () => {
    rbac.managedSites.mockResolvedValue([]);

    await expect(
      service.create({ name: 'Coursier', siteId: 's-1' }, 'u-agent'),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });
});
