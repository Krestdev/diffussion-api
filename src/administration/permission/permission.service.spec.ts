import { Test, TestingModule } from '@nestjs/testing';
import { ForbiddenException } from '@nestjs/common';
import { PLATFORM_PERMISSIONS } from '../../auth/rbac/rbac.constants';
import { RbacService } from '../../auth/rbac/rbac.service';
import { DatabaseService } from '../../database/database.service';
import { PermissionService } from './permission.service';

describe('PermissionService', () => {
  let service: PermissionService;
  let database: { permission: Record<string, jest.Mock> };
  let rbac: { administeredSites: jest.Mock };

  beforeEach(async () => {
    database = { permission: { findMany: jest.fn().mockResolvedValue([]) } };
    rbac = { administeredSites: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PermissionService,
        { provide: DatabaseService, useValue: database },
        { provide: RbacService, useValue: rbac },
      ],
    }).compile();

    service = module.get<PermissionService>(PermissionService);
  });

  it('lists every permission to a platform administrator', async () => {
    rbac.administeredSites.mockResolvedValue('ALL');

    await service.findAll('super-admin');

    expect(database.permission.findMany).toHaveBeenCalledWith({
      where: { display: true },
      orderBy: { code: 'asc' },
    });
  });

  it("hides the platform permissions from a site's responsible", async () => {
    rbac.administeredSites.mockResolvedValue(['s-1']);

    await service.findAll('resp-s1');

    expect(database.permission.findMany).toHaveBeenCalledWith({
      where: { display: true, code: { notIn: [...PLATFORM_PERMISSIONS] } },
      orderBy: { code: 'asc' },
    });
  });

  it('refuses someone who administers nothing', async () => {
    rbac.administeredSites.mockResolvedValue([]);

    await expect(service.findAll('nobody')).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });
});
