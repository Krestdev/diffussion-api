import { Test, TestingModule } from '@nestjs/testing';
import { DatabaseService } from '../../database/database.service';
import { EventsGateway } from '../../events/events.gateway';
import { UsersService } from './users.service';

describe('UsersService', () => {
  let service: UsersService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UsersService,
        { provide: DatabaseService, useValue: {} },
        { provide: EventsGateway, useValue: { broadcast: jest.fn() } },
      ],
    }).compile();

    service = module.get<UsersService>(UsersService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('findAll', () => {
    it('paginates with defaults and strips password/refreshToken', async () => {
      const database = {
        user: {
          findMany: jest.fn().mockResolvedValue([
            {
              id: 'u-1',
              name: 'Jane',
              password: 'hashed',
              refreshToken: 'rt',
              userRoles: [],
              assignments: [],
            },
          ]),
          count: jest.fn().mockResolvedValue(1),
        },
        $transaction: jest.fn((ops: unknown[]) => Promise.all(ops)),
      };
      const module: TestingModule = await Test.createTestingModule({
        providers: [
          UsersService,
          { provide: DatabaseService, useValue: database },
          { provide: EventsGateway, useValue: { broadcast: jest.fn() } },
        ],
      }).compile();
      const paginated = module.get<UsersService>(UsersService);

      const result = await paginated.findAll({});

      expect(result).toEqual({
        data: [{ id: 'u-1', name: 'Jane', roles: [], sites: [] }],
        total: 1,
        skip: 0,
        take: 20,
      });
      expect(database.user.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ skip: 0, take: 20 }),
      );
    });
  });
});
