import { Test, TestingModule } from '@nestjs/testing';
import { DatabaseService } from '../../database/database.service';
import { CategoryService } from './category.service';

describe('CategoryService', () => {
  let service: CategoryService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [CategoryService, { provide: DatabaseService, useValue: {} }],
    }).compile();

    service = module.get<CategoryService>(CategoryService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('findAll', () => {
    it('paginates with defaults and returns the envelope', async () => {
      const database = {
        category: {
          findMany: jest.fn().mockResolvedValue([{ id: 'c-1' }]),
          count: jest.fn().mockResolvedValue(1),
        },
        $transaction: jest.fn((ops: unknown[]) => Promise.all(ops)),
      };
      const module: TestingModule = await Test.createTestingModule({
        providers: [CategoryService, { provide: DatabaseService, useValue: database }],
      }).compile();
      const paginated = module.get<CategoryService>(CategoryService);

      const result = await paginated.findAll({});

      expect(result).toEqual({ data: [{ id: 'c-1' }], total: 1, skip: 0, take: 20 });
      expect(database.category.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ skip: 0, take: 20 }),
      );
    });
  });
});
