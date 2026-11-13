import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { ActivityService } from '../../activity/activity.service';
import { RbacService } from '../../auth/rbac/rbac.service';
import { DatabaseService } from '../../database/database.service';
import { DelegationService } from './delegation.service';

const VALID = {
  delegantId: 'u-1',
  delegataireId: 'u-2',
  roleId: 'r-1',
  siteId: 's-1',
  responsibility: 'Traitement du courrier',
  startDate: '2026-09-22',
  endDate: '2026-10-05',
};

describe('DelegationService', () => {
  let service: DelegationService;
  let database: {
    delegation: Record<string, jest.Mock>;
    user: Record<string, jest.Mock>;
    role: Record<string, jest.Mock>;
    site: Record<string, jest.Mock>;
    userRole: Record<string, jest.Mock>;
  };
  let rbac: { administeredSites: jest.Mock };

  beforeEach(async () => {
    database = {
      delegation: {
        create: jest.fn().mockResolvedValue({ id: 'd-1' }),
        findUnique: jest.fn().mockResolvedValue({ id: 'd-1' }),
        update: jest.fn().mockResolvedValue({ id: 'd-1' }),
        // No overlapping delegation unless a test says otherwise.
        findFirst: jest.fn().mockResolvedValue(null),
      },
      user: {
        findUnique: jest.fn().mockResolvedValue({
          name: 'Someone',
          status: 'ACTIVE',
          siteId: 's-1',
        }),
      },
      role: { findUnique: jest.fn().mockResolvedValue({ name: 'Chef' }) },
      // The delegant holds the role they hand over.
      userRole: { findFirst: jest.fn().mockResolvedValue({ id: 'ur-1' }) },
      site: {
        findUnique: jest
          .fn()
          .mockResolvedValue({ name: 'Cristal', status: 'ACTIVE' }),
      },
    };

    // A platform administrator unless a test says otherwise.
    rbac = { administeredSites: jest.fn().mockResolvedValue('ALL') };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DelegationService,
        { provide: DatabaseService, useValue: database },
        { provide: RbacService, useValue: rbac },
        {
          provide: ActivityService,
          useValue: {
            record: jest.fn().mockResolvedValue('log-1'),
            tryRecord: jest.fn().mockResolvedValue('log-1'),
          },
        },
      ],
    }).compile();

    service = module.get<DelegationService>(DelegationService);
  });

  it('creates a valid delegation, converting the ISO strings to Dates', async () => {
    await service.create(VALID, 'admin');

    const { data } = database.delegation.create.mock.calls[0][0] as {
      data: { startDate: Date; endDate: Date; roleId: string; siteId: string };
    };
    expect(data.startDate).toBeInstanceOf(Date);
    expect(data.startDate.toISOString()).toBe('2026-09-22T00:00:00.000Z');
    expect(data.roleId).toBe('r-1');
    expect(data.siteId).toBe('s-1');
  });

  it('refuses an end date before the start date', async () => {
    await expect(
      service.create(
        { ...VALID, startDate: '2026-10-05', endDate: '2026-09-22' },
        'admin',
      ),
    ).rejects.toThrow(
      new BadRequestException('endDate must not be before startDate'),
    );
    expect(database.delegation.create).not.toHaveBeenCalled();
  });

  it('refuses a delegation to oneself', async () => {
    await expect(
      service.create({ ...VALID, delegataireId: VALID.delegantId }, 'admin'),
    ).rejects.toThrow(
      new BadRequestException('A user cannot delegate to themselves'),
    );
  });

  it('refuses when the delegataire does not belong to the site', async () => {
    database.user.findUnique.mockImplementation(
      ({ where }: { where: { id: string } }) =>
        Promise.resolve({
          name: where.id === 'u-2' ? 'Paul' : 'Awa',
          status: 'ACTIVE',
          siteId: where.id === 'u-2' ? 's-2' : 's-1',
        }),
    );

    await expect(service.create(VALID, 'admin')).rejects.toThrow(
      new BadRequestException(
        'Paul does not belong to site "Cristal" — a role can only be delegated within the site',
      ),
    );
  });

  it('refuses a suspended delegataire', async () => {
    database.user.findUnique.mockImplementation(
      ({ where }: { where: { id: string } }) =>
        Promise.resolve({
          name: where.id === 'u-2' ? 'Paul' : 'Awa',
          status: where.id === 'u-2' ? 'SUSPENDED' : 'ACTIVE',
          siteId: 's-1',
        }),
    );

    await expect(service.create(VALID, 'admin')).rejects.toThrow(
      new BadRequestException(
        'Paul is suspended and cannot receive a delegation',
      ),
    );
  });

  it('refuses an inactive site', async () => {
    database.site.findUnique.mockResolvedValue({
      name: 'Annexe',
      status: 'INACTIVE',
    });

    await expect(service.create(VALID, 'admin')).rejects.toThrow(
      BadRequestException,
    );
  });

  it('refuses a second delegation of the same role/site overlapping in time', async () => {
    database.delegation.findFirst.mockResolvedValue({
      startDate: new Date('2026-09-20'),
      endDate: new Date('2026-09-30'),
    });

    await expect(service.create(VALID, 'admin')).rejects.toThrow(
      /already holds this role at "Cristal"/,
    );
  });

  it('only converts the dates it was given on update', async () => {
    database.delegation.findUnique.mockResolvedValue({
      id: 'd-1',
      delegantId: 'u-1',
      delegataireId: 'u-2',
      roleId: 'r-1',
      siteId: 's-1',
      startDate: new Date('2026-09-22'),
      endDate: new Date('2026-10-05'),
    });

    await service.update('d-1', { endDate: '2026-11-30' }, 'admin');

    const { data } = database.delegation.update.mock.calls[0][0] as {
      data: Record<string, unknown>;
    };
    expect(data.endDate).toBeInstanceOf(Date);
    expect(data).not.toHaveProperty('startDate');
  });

  describe("site responsible (the site's administrator)", () => {
    beforeEach(() => rbac.administeredSites.mockResolvedValue(['s-1']));

    it('creates a delegation at their own site', async () => {
      await service.create(VALID, 'site-admin');
      expect(database.delegation.create).toHaveBeenCalled();
    });

    it('cannot create a delegation at another site', async () => {
      await expect(
        service.create({ ...VALID, siteId: 's-2' }, 'site-admin'),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(database.delegation.create).not.toHaveBeenCalled();
    });

    it("cannot read another site's delegation", async () => {
      database.delegation.findUnique.mockResolvedValue({
        id: 'd-1',
        siteId: 's-2',
      });
      await expect(service.findOne('d-1', 'site-admin')).rejects.toBeInstanceOf(
        ForbiddenException,
      );
    });

    it('only lists their own site', async () => {
      database.delegation.findMany = jest.fn().mockReturnValue('rows');
      database.delegation.count = jest.fn().mockReturnValue('count');
      (database as unknown as { $transaction: jest.Mock }).$transaction = jest
        .fn()
        .mockResolvedValue([[], 0]);

      await service.findAll({}, 'site-admin');

      expect(database.delegation.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { AND: [{}, { siteId: { in: ['s-1'] } }] },
        }),
      );
    });
  });
});
