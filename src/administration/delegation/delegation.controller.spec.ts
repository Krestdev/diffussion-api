import { CoreAuthGuard } from '../../auth/guards/core-auth.guard';
import { Test, TestingModule } from '@nestjs/testing';
import { ActivityService } from '../../activity/activity.service';
import { DatabaseService } from '../../database/database.service';
import { PermissionsGuard } from '../../auth/access/permissions.guard';
import { AccessService } from '../../auth/access/access.service';
import { DelegationController } from './delegation.controller';
import { DelegationService } from './delegation.service';

describe('DelegationController', () => {
  let controller: DelegationController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [DelegationController],
      providers: [
        DelegationService,
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

    controller = module.get<DelegationController>(DelegationController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});
