import { Test, TestingModule } from '@nestjs/testing';
import { PermissionGuard } from '../../auth/rbac/permission.guard';
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
