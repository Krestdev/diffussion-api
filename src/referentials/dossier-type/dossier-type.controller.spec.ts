import { Test, TestingModule } from '@nestjs/testing';
import { PermissionGuard } from '../../auth/rbac/permission.guard';
import { ActivityService } from '../../activity/activity.service';
import { DatabaseService } from '../../database/database.service';
import { DossierTypeController } from './dossier-type.controller';
import { DossierTypeService } from './dossier-type.service';

describe('DossierTypeController', () => {
  let controller: DossierTypeController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [DossierTypeController],
      providers: [
        DossierTypeService,
        { provide: DatabaseService, useValue: {} },
        { provide: ActivityService, useValue: {} },
      ],
    })
      .overrideGuard(PermissionGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = module.get<DossierTypeController>(DossierTypeController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});
