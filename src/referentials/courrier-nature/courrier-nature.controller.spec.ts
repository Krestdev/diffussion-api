import { CoreAuthGuard } from '../../auth/guards/core-auth.guard';
import { Test, TestingModule } from '@nestjs/testing';
import { PermissionsGuard } from '../../auth/access/permissions.guard';
import { ActivityService } from '../../activity/activity.service';
import { DatabaseService } from '../../database/database.service';
import { CourrierNatureController } from './courrier-nature.controller';
import { CourrierNatureService } from './courrier-nature.service';

describe('CourrierNatureController', () => {
  let controller: CourrierNatureController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [CourrierNatureController],
      providers: [
        CourrierNatureService,
        { provide: DatabaseService, useValue: {} },
        { provide: ActivityService, useValue: {} },
      ],
    })
      .overrideGuard(PermissionsGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(CoreAuthGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = module.get<CourrierNatureController>(CourrierNatureController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});
