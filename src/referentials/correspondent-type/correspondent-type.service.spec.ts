import { Test, TestingModule } from '@nestjs/testing';
import { DatabaseService } from '../../database/database.service';
import { CorrespondentTypeService } from './correspondent-type.service';

describe('CorrespondentTypeService', () => {
  let service: CorrespondentTypeService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CorrespondentTypeService,
        { provide: DatabaseService, useValue: {} },
      ],
    }).compile();

    service = module.get<CorrespondentTypeService>(CorrespondentTypeService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('findAll', () => {
    it('paginates with defaults and returns the envelope', async () => {
      const database = {
        correspondentType: {
          findMany: jest.fn().mockResolvedValue([{ id: 'ct-1' }]),
          count: jest.fn().mockResolvedValue(1),
        },
        $transaction: jest.fn((ops: unknown[]) => Promise.all(ops)),
      };
      const module: TestingModule = await Test.createTestingModule({
        providers: [
          CorrespondentTypeService,
          { provide: DatabaseService, useValue: database },
        ],
      }).compile();
      const paginated = module.get<CorrespondentTypeService>(
        CorrespondentTypeService,
      );

      const result = await paginated.findAll({});

      expect(result).toEqual({ data: [{ id: 'ct-1' }], total: 1, skip: 0, take: 20 });
      expect(database.correspondentType.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ skip: 0, take: 20 }),
      );
    });
  });
});
