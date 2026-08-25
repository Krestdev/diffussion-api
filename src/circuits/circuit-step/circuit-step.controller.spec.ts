import { Test, TestingModule } from '@nestjs/testing';
import { CircuitStepController } from './circuit-step.controller';
import { CircuitStepService } from './circuit-step.service';

describe('CircuitStepController', () => {
  let controller: CircuitStepController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [CircuitStepController],
      providers: [CircuitStepService],
    }).compile();

    controller = module.get<CircuitStepController>(CircuitStepController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});
