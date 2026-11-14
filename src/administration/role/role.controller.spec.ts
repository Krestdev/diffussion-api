import { Test, TestingModule } from '@nestjs/testing';
import { PermissionsGuard } from '../../auth/access/permissions.guard';
import { CoreAuthGuard } from '../../auth/guards/core-auth.guard';
import { AuthUser } from '../../auth/types/auth-user.type';
import { RoleController } from './role.controller';
import { RoleService } from './role.service';

describe('RoleController', () => {
  let controller: RoleController;
  const roles = {
    create: jest.fn(),
    findAll: jest.fn(),
    get: jest.fn(),
    update: jest.fn(),
    archive: jest.fn(),
    unarchive: jest.fn(),
    restoreDefaults: jest.fn(),
  };
  const user: AuthUser = {
    sub: 'u-1',
    email: 'u@x',
    name: 'U',
    companyId: 's-1',
    sid: 'sid',
    impersonator: null,
    permissions: new Set<string>(),
    platformAdmin: false,
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      controllers: [RoleController],
      providers: [{ provide: RoleService, useValue: roles }],
    })
      .overrideGuard(PermissionsGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(CoreAuthGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = module.get<RoleController>(RoleController);
  });

  it("acts on the person's own company", async () => {
    await controller.create({ name: 'Agent', permissions: [] }, user);
    expect(roles.create).toHaveBeenCalledWith('s-1', {
      name: 'Agent',
      permissions: [],
    });
    await controller.archive('r-1', { reassignToRoleId: 'r-2' }, user);
    expect(roles.archive).toHaveBeenCalledWith('s-1', 'r-1', {
      reassignToRoleId: 'r-2',
    });
  });

  it("lists nothing of another company's", async () => {
    const page = await controller.findAll({ companyId: 's-2' }, user);
    expect(page).toMatchObject({ data: [], total: 0 });
    expect(roles.findAll).not.toHaveBeenCalled();
  });
});
