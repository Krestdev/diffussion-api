import { Test, TestingModule } from '@nestjs/testing';
import { DatabaseService } from '../../database/database.service';
import { ProjectService } from './project.service';

describe('ProjectService', () => {
  let service: ProjectService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [ProjectService, { provide: DatabaseService, useValue: {} }],
    }).compile();

    service = module.get<ProjectService>(ProjectService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('findAll', () => {
    it('paginates with defaults and returns the envelope', async () => {
      const database = {
        project: {
          findMany: jest.fn().mockResolvedValue([{ id: 'p-1' }]),
          count: jest.fn().mockResolvedValue(1),
        },
        $transaction: jest.fn((ops: unknown[]) => Promise.all(ops)),
      };
      const module: TestingModule = await Test.createTestingModule({
        providers: [ProjectService, { provide: DatabaseService, useValue: database }],
      }).compile();
      const paginated = module.get<ProjectService>(ProjectService);

      const result = await paginated.findAll({});

      expect(result).toEqual({ data: [{ id: 'p-1' }], total: 1, skip: 0, take: 20 });
      expect(database.project.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ skip: 0, take: 20 }),
      );
    });
  });
});
