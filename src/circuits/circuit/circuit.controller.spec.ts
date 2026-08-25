import { Test, TestingModule } from '@nestjs/testing';
import { PermissionGuard } from '../../auth/rbac/permission.guard';
import { DatabaseService } from '../../database/database.service';
import { CircuitController } from './circuit.controller';
import { CircuitService } from './circuit.service';

describe('CircuitController', () => {
  let controller: CircuitController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [CircuitController],
      providers: [CircuitService, { provide: DatabaseService, useValue: {} }],
    })
      .overrideGuard(PermissionGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = module.get<CircuitController>(CircuitController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});
