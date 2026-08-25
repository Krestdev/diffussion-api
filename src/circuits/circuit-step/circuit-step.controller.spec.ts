import { Test, TestingModule } from '@nestjs/testing';
import { PermissionGuard } from '../../auth/rbac/permission.guard';
import { DatabaseService } from '../../database/database.service';
import { CircuitStepController } from './circuit-step.controller';
import { CircuitStepService } from './circuit-step.service';

describe('CircuitStepController', () => {
  let controller: CircuitStepController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [CircuitStepController],
      providers: [
        CircuitStepService,
        { provide: DatabaseService, useValue: {} },
      ],
    })
      .overrideGuard(PermissionGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = module.get<CircuitStepController>(CircuitStepController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});
