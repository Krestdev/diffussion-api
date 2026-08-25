import { Test, TestingModule } from '@nestjs/testing';
import { PermissionGuard } from '../../auth/rbac/permission.guard';
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
      ],
    })
      .overrideGuard(PermissionGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = module.get<CourrierNatureController>(CourrierNatureController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});
