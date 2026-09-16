import { Test, TestingModule } from '@nestjs/testing';
import { DatabaseService } from '../../database/database.service';
import { RoleService } from './role.service';

describe('RoleService', () => {
  let service: RoleService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [RoleService, { provide: DatabaseService, useValue: {} }],
    }).compile();

    service = module.get<RoleService>(RoleService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('findAll', () => {
    it('paginates with defaults and maps each role through toView', async () => {
      const database = {
        role: {
          findMany: jest.fn().mockResolvedValue([
            {
              id: 'r-1',
              name: 'Approbateur',
              rolePermissions: [{ permission: { id: 'p-1' } }],
              _count: { userRoles: 3 },
            },
          ]),
          count: jest.fn().mockResolvedValue(1),
        },
        $transaction: jest.fn((ops: unknown[]) => Promise.all(ops)),
      };
      const module: TestingModule = await Test.createTestingModule({
        providers: [RoleService, { provide: DatabaseService, useValue: database }],
      }).compile();
      const paginated = module.get<RoleService>(RoleService);

      const result = await paginated.findAll({});

      expect(result).toEqual({
        data: [
          {
            id: 'r-1',
            name: 'Approbateur',
            permissions: [{ id: 'p-1' }],
            usersCount: 3,
          },
        ],
        total: 1,
        skip: 0,
        take: 20,
      });
      expect(database.role.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ skip: 0, take: 20 }),
      );
    });
  });
});
