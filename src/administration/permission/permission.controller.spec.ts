import { Test, TestingModule } from '@nestjs/testing';
import { PermissionsGuard } from '../../auth/access/permissions.guard';
import { CoreAuthGuard } from '../../auth/guards/core-auth.guard';
import { CATALOG_VERSION } from '../../auth/permissions';
import { RoleService } from '../role/role.service';
import { PermissionController } from './permission.controller';

describe('PermissionController', () => {
  let controller: PermissionController;
  const catalog = { version: CATALOG_VERSION, groups: [], implies: {} };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [PermissionController],
      providers: [
        { provide: RoleService, useValue: { catalog: () => catalog } },
      ],
    })
      .overrideGuard(PermissionsGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(CoreAuthGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = module.get<PermissionController>(PermissionController);
  });

  it('serves the catalogue', () => {
    expect(controller.catalog()).toBe(catalog);
  });
});
