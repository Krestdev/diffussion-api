import { Test, TestingModule } from '@nestjs/testing';
import { DatabaseService } from '../../database/database.service';
import { SiteService } from './site.service';

describe('SiteService', () => {
  let service: SiteService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [SiteService, { provide: DatabaseService, useValue: {} }],
    }).compile();

    service = module.get<SiteService>(SiteService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('findAll', () => {
    it('paginates with defaults and returns the envelope', async () => {
      const database = {
        site: {
          findMany: jest.fn().mockResolvedValue([{ id: 's-1' }]),
          count: jest.fn().mockResolvedValue(1),
        },
        $transaction: jest.fn((ops: unknown[]) => Promise.all(ops)),
      };
      const module: TestingModule = await Test.createTestingModule({
        providers: [SiteService, { provide: DatabaseService, useValue: database }],
      }).compile();
      const paginated = module.get<SiteService>(SiteService);

      const result = await paginated.findAll({});

      expect(result).toEqual({ data: [{ id: 's-1' }], total: 1, skip: 0, take: 20 });
      expect(database.site.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ skip: 0, take: 20 }),
      );
    });
  });
});
