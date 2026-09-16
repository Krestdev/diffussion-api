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

  describe('findAll', () => {
    it('paginates with defaults and returns the envelope', async () => {
      const database = {
        circuit: {
          findMany: jest.fn().mockResolvedValue([{ id: 'ci-1' }]),
          count: jest.fn().mockResolvedValue(1),
        },
        $transaction: jest.fn((ops: unknown[]) => Promise.all(ops)),
      };
      const module: TestingModule = await Test.createTestingModule({
        providers: [CircuitService, { provide: DatabaseService, useValue: database }],
      }).compile();
      const paginated = module.get<CircuitService>(CircuitService);

      const result = await paginated.findAll({});

      expect(result).toEqual({ data: [{ id: 'ci-1' }], total: 1, skip: 0, take: 20 });
      expect(database.circuit.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ skip: 0, take: 20 }),
      );
    });
  });
});
