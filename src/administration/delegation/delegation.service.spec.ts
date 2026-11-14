import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { ActivityService } from '../../activity/activity.service';
import { AccessService } from '../../auth/access/access.service';
import { DatabaseService } from '../../database/database.service';
import { DelegationService } from './delegation.service';

const VALID = {
  delegantId: 'u-1',
  delegataireId: 'u-2',
  roleId: 'r-1',
  companyId: 's-1',
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
    company: Record<string, jest.Mock>;
    userRole: Record<string, jest.Mock>;
  };
  let rbac: { scope: jest.Mock };

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
          companyId: 's-1',
        }),
      },
      role: {
        findUnique: jest.fn().mockResolvedValue({
          name: 'Chef',
          companyId: 's-1',
          archivedAt: null,
        }),
      },
      // The delegant holds the role they hand over.
      userRole: { findFirst: jest.fn().mockResolvedValue({ id: 'ur-1' }) },
      company: {
        findUnique: jest
          .fn()
          .mockResolvedValue({ name: 'Cristal', status: 'ACTIVE' }),
      },
    };

    // An administrator (role.assign) of company s-1 unless a test says otherwise.
    rbac = { scope: jest.fn().mockResolvedValue(['s-1']) };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DelegationService,
        { provide: DatabaseService, useValue: database },
        { provide: AccessService, useValue: rbac },
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
      data: {
        startDate: Date;
        endDate: Date;
        roleId: string;
        companyId: string;
      };
    };
    expect(data.startDate).toBeInstanceOf(Date);
    expect(data.startDate.toISOString()).toBe('2026-09-22T00:00:00.000Z');
    expect(data.roleId).toBe('r-1');
    expect(data.companyId).toBe('s-1');
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

  it('refuses when the delegataire does not belong to the company', async () => {
    database.user.findUnique.mockImplementation(
      ({ where }: { where: { id: string } }) =>
        Promise.resolve({
          name: where.id === 'u-2' ? 'Paul' : 'Awa',
          status: 'ACTIVE',
          companyId: where.id === 'u-2' ? 's-2' : 's-1',
        }),
    );

    await expect(service.create(VALID, 'admin')).rejects.toThrow(
      new BadRequestException(
        'Paul does not belong to company "Cristal" — a role can only be delegated within the company',
      ),
    );
  });

  it('refuses a suspended delegataire', async () => {
    database.user.findUnique.mockImplementation(
      ({ where }: { where: { id: string } }) =>
        Promise.resolve({
          name: where.id === 'u-2' ? 'Paul' : 'Awa',
          status: where.id === 'u-2' ? 'SUSPENDED' : 'ACTIVE',
          companyId: 's-1',
        }),
    );

    await expect(service.create(VALID, 'admin')).rejects.toThrow(
      new BadRequestException(
        'Paul is suspended and cannot receive a delegation',
      ),
    );
  });

  it('refuses an inactive company', async () => {
    database.company.findUnique.mockResolvedValue({
      name: 'Annexe',
      status: 'INACTIVE',
    });

    await expect(service.create(VALID, 'admin')).rejects.toThrow(
      BadRequestException,
    );
  });

  it('refuses a second delegation of the same role/company overlapping in time', async () => {
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
      companyId: 's-1',
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

  it('refuses a role of another company', async () => {
    database.role.findUnique.mockResolvedValue({
      name: 'Chef',
      companyId: 's-2',
      archivedAt: null,
    });

    await expect(service.create(VALID, 'admin')).rejects.toThrow(
      /is not a role of company "Cristal"/,
    );
  });

  it('is refused without role.assign', async () => {
    rbac.scope.mockResolvedValue([]);

    await expect(service.create(VALID, 'admin')).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  describe("company responsible (the company's administrator)", () => {
    beforeEach(() => rbac.scope.mockResolvedValue(['s-1']));

    it('creates a delegation at their own company', async () => {
      await service.create(VALID, 'company-admin');
      expect(database.delegation.create).toHaveBeenCalled();
    });

    it('cannot create a delegation at another company', async () => {
      await expect(
        service.create({ ...VALID, companyId: 's-2' }, 'company-admin'),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(database.delegation.create).not.toHaveBeenCalled();
    });

    it("cannot read another company's delegation", async () => {
      database.delegation.findUnique.mockResolvedValue({
        id: 'd-1',
        companyId: 's-2',
      });
      await expect(
        service.findOne('d-1', 'company-admin'),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('only lists their own company', async () => {
      database.delegation.findMany = jest.fn().mockReturnValue('rows');
      database.delegation.count = jest.fn().mockReturnValue('count');
      (database as unknown as { $transaction: jest.Mock }).$transaction = jest
        .fn()
        .mockResolvedValue([[], 0]);

      await service.findAll({}, 'company-admin');

      expect(database.delegation.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { AND: [{}, { companyId: { in: ['s-1'] } }] },
        }),
      );
    });
  });
});
