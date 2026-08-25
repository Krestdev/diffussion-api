import { Test, TestingModule } from '@nestjs/testing';
import { CircuitStepService } from './circuit-step.service';

describe('CircuitStepService', () => {
  let service: CircuitStepService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [CircuitStepService],
    }).compile();

    service = module.get<CircuitStepService>(CircuitStepService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
