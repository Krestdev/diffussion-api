import { Test, TestingModule } from '@nestjs/testing';
import { PermissionGuard } from '../../auth/rbac/permission.guard';
import { DatabaseService } from '../../database/database.service';
import { CanalController } from './canal.controller';
import { CanalService } from './canal.service';

describe('CanalController', () => {
  let controller: CanalController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [CanalController],
      providers: [CanalService, { provide: DatabaseService, useValue: {} }],
    })
      .overrideGuard(PermissionGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = module.get<CanalController>(CanalController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});
