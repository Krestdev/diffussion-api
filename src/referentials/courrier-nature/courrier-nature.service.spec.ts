import { Test, TestingModule } from '@nestjs/testing';
import { DatabaseService } from '../../database/database.service';
import { CourrierNatureService } from './courrier-nature.service';

describe('CourrierNatureService', () => {
  let service: CourrierNatureService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CourrierNatureService,
        { provide: DatabaseService, useValue: {} },
      ],
    }).compile();

    service = module.get<CourrierNatureService>(CourrierNatureService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('findAll', () => {
    it('paginates with defaults and returns the envelope', async () => {
      const database = {
        courrierNature: {
          findMany: jest.fn().mockResolvedValue([{ id: 'n-1' }]),
          count: jest.fn().mockResolvedValue(1),
        },
        $transaction: jest.fn((ops: unknown[]) => Promise.all(ops)),
      };
      const module: TestingModule = await Test.createTestingModule({
        providers: [
          CourrierNatureService,
          { provide: DatabaseService, useValue: database },
        ],
      }).compile();
      const paginated = module.get<CourrierNatureService>(CourrierNatureService);

      const result = await paginated.findAll({});

      expect(result).toEqual({ data: [{ id: 'n-1' }], total: 1, skip: 0, take: 20 });
      expect(database.courrierNature.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ skip: 0, take: 20 }),
      );
    });
  });
});
