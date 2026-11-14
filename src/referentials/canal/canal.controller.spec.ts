import { CoreAuthGuard } from '../../auth/guards/core-auth.guard';
import { Test, TestingModule } from '@nestjs/testing';
import { PermissionsGuard } from '../../auth/access/permissions.guard';
import { ActivityService } from '../../activity/activity.service';
import { AccessService } from '../../auth/access/access.service';
import { DatabaseService } from '../../database/database.service';
import { CanalController } from './canal.controller';
import { CanalService } from './canal.service';

describe('CanalController', () => {
  let controller: CanalController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [CanalController],
      providers: [
        CanalService,
        { provide: DatabaseService, useValue: {} },
        { provide: ActivityService, useValue: {} },
        { provide: AccessService, useValue: {} },
      ],
    })
      .overrideGuard(PermissionsGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(CoreAuthGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = module.get<CanalController>(CanalController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});
