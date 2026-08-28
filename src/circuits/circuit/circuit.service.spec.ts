import { Test, TestingModule } from '@nestjs/testing';
import { DatabaseService } from '../../database/database.service';
import { CircuitService } from './circuit.service';

describe('CircuitService', () => {
  let service: CircuitService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [CircuitService, { provide: DatabaseService, useValue: {} }],
    }).compile();

    service = module.get<CircuitService>(CircuitService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
