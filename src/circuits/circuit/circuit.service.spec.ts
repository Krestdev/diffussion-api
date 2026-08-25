import { Test, TestingModule } from '@nestjs/testing';
import { CircuitService } from './circuit.service';

describe('CircuitService', () => {
  let service: CircuitService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [CircuitService],
    }).compile();

    service = module.get<CircuitService>(CircuitService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
