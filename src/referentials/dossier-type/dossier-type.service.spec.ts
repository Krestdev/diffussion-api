import { Test, TestingModule } from '@nestjs/testing';
import { DatabaseService } from '../../database/database.service';
import { DossierTypeService } from './dossier-type.service';

describe('DossierTypeService', () => {
  let service: DossierTypeService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DossierTypeService,
        { provide: DatabaseService, useValue: {} },
      ],
    }).compile();

    service = module.get<DossierTypeService>(DossierTypeService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('findAll', () => {
    it('paginates with defaults and returns the envelope', async () => {
      const database = {
        dossierType: {
          findMany: jest.fn().mockResolvedValue([{ id: 't-1' }]),
          count: jest.fn().mockResolvedValue(1),
        },
        $transaction: jest.fn((ops: unknown[]) => Promise.all(ops)),
      };
      const module: TestingModule = await Test.createTestingModule({
        providers: [
          DossierTypeService,
          { provide: DatabaseService, useValue: database },
        ],
      }).compile();
      const paginated = module.get<DossierTypeService>(DossierTypeService);

      const result = await paginated.findAll({});

      expect(result).toEqual({ data: [{ id: 't-1' }], total: 1, skip: 0, take: 20 });
      expect(database.dossierType.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ skip: 0, take: 20 }),
      );
    });
  });
});
