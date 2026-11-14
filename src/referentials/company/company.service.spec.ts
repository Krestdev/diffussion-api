import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { ActivityService } from '../../activity/activity.service';
import { AccessService } from '../../auth/access/access.service';
import { DatabaseService } from '../../database/database.service';
import { ALL_PERMISSIONS } from '../../auth/permissions';
import { accessMock, AccessMock } from '../access-mock.testing-spec';
import { setUpCompany, CompanyService } from './company.service';

const COMPANY = { id: 's-1', name: 'Cristal', responsibleId: 'u-old' };

describe('CompanyService', () => {
  let service: CompanyService;
  let database: {
    company: Record<string, jest.Mock>;
    user: Record<string, jest.Mock>;
    userRole: Record<string, jest.Mock>;
    delegation: Record<string, jest.Mock>;
    analysisCriterionTemplate: Record<string, jest.Mock>;
    permission: Record<string, jest.Mock>;
    role: Record<string, jest.Mock>;
    $transaction: jest.Mock;
  };
  let access: AccessMock;

  const responsible = (overrides: Record<string, unknown> = {}) => ({
    name: 'Awa',
    status: 'ACTIVE',
    companyId: 's-9',
    managedCompanies: [],
    ...overrides,
  });

  beforeEach(async () => {
    database = {
      company: {
        create: jest.fn().mockResolvedValue({ id: 's-new' }),
        findUnique: jest.fn().mockResolvedValue(COMPANY),
        update: jest.fn().mockResolvedValue(COMPANY),
      },
      user: {
        findUnique: jest.fn().mockResolvedValue(responsible()),
        findMany: jest.fn().mockResolvedValue([{ id: 'u-resp' }]),
        findUniqueOrThrow: jest.fn().mockResolvedValue({ companyId: 's-9' }),
        update: jest.fn(),
      },
      userRole: {
        updateMany: jest.fn(),
        deleteMany: jest.fn(),
        createMany: jest.fn(),
      },
      // The default roles (ADMIN, Réceptionniste, Dispatcher, Admin
      // dispatcher) and the permissions they are made of.
      permission: {
        findMany: jest
          .fn()
          .mockResolvedValue(
            ALL_PERMISSIONS.map((code) => ({ id: `p-${code}`, code })),
          ),
      },
      role: {
        create: jest.fn(({ data }: { data: { name: string } }) =>
          Promise.resolve({ id: `r-${data.name}` }),
        ),
        // No default role yet; then the ADMIN one just made.
        findFirst: jest.fn(({ where }: { where: { code?: string } }) =>
          Promise.resolve(where.code === 'ADMIN' ? { id: 'r-Admin' } : null),
        ),
      },
      delegation: { deleteMany: jest.fn() },
      // The common model of analysis criteria, copied onto a new company.
      analysisCriterionTemplate: {
        findMany: jest.fn().mockResolvedValue([
          {
            label: 'Forme',
            description: null,
            order: 1,
            isActive: true,
            appliedByDefault: true,
          },
        ]),
        createMany: jest.fn(),
      },
      $transaction: jest.fn(),
    };
    database.$transaction.mockImplementation(
      (change: (tx: typeof database) => unknown) => change(database),
    );
    // company.update in their own company s-1.
    access = accessMock({ permissions: ['company.update', 'company.read'] });

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CompanyService,
        { provide: DatabaseService, useValue: database },
        { provide: AccessService, useValue: access },
        {
          provide: ActivityService,
          useValue: {
            record: jest.fn().mockResolvedValue('log-1'),
            tryRecord: jest.fn().mockResolvedValue('log-1'),
          },
        },
      ],
    }).compile();

    service = module.get<CompanyService>(CompanyService);
  });

  describe('update', () => {
    it('lets a holder of company.update edit their own company', async () => {
      await service.update('s-1', { city: 'Douala' }, 'u-old');

      expect(database.company.update).toHaveBeenCalled();
    });

    it("refuses another company's people", async () => {
      access.state.companyId = 's-2';

      await expect(
        service.update('s-1', { city: 'Douala' }, 'u-other'),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('refuses someone without company.update', async () => {
      access.state.permissions = ['company.read'];

      await expect(
        service.update('s-1', { responsibleId: 'u-1' }, 'u-old'),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('lets a holder of company.update name a person of the company responsible', async () => {
      database.user.findUnique.mockResolvedValue(
        responsible({ companyId: 's-1' }),
      );

      await service.update('s-1', { responsibleId: 'u-1' }, 'super-admin');

      expect(database.company.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: { responsibleId: 'u-1' } }),
      );
    });

    it('refuses a responsible from another company', async () => {
      await expect(
        service.update('s-1', { responsibleId: 'u-1' }, 'super-admin'),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(database.company.update).not.toHaveBeenCalled();
    });

    it('refuses the responsible of another company', async () => {
      database.user.findUnique.mockResolvedValue(
        responsible({
          companyId: 's-1',
          managedCompanies: [{ id: 's-9', name: 'Akwa' }],
        }),
      );

      await expect(
        service.update('s-1', { responsibleId: 'u-1' }, 'super-admin'),
      ).rejects.toThrow('Awa is already the responsible of company "Akwa"');
    });
  });

  // A new company (from the core's directory) is set up by setUpCompany.
  it('gives a new company its own copy of the analysis criteria', async () => {
    await setUpCompany(database as never, 's-new', null);

    expect(database.analysisCriterionTemplate.createMany).toHaveBeenCalledWith({
      data: [
        {
          label: 'Forme',
          description: null,
          order: 1,
          isActive: true,
          appliedByDefault: true,
          companyId: 's-new',
        },
      ],
    });
  });

  it('gives a new company its 4 default roles, Admin to its responsible', async () => {
    await setUpCompany(database as never, 's-new', 'u-resp');

    const created = database.role.create.mock.calls.map(
      ([args]) =>
        args as {
          data: {
            name: string;
            code: string;
            isSystem: boolean;
            companyId: string;
            rolePermissions: { create: { permissionId: string }[] };
          };
        },
    );
    expect(created.map((c) => [c.data.code, c.data.name])).toEqual([
      ['ADMIN', 'Admin'],
      ['RECEPTIONIST', 'Réceptionniste'],
      ['DISPATCHER', 'Dispatcher'],
      ['ADMIN_DISPATCHER', 'Admin dispatcher'],
    ]);
    expect(created.every((c) => c.data.companyId === 's-new')).toBe(true);
    expect(created.every((c) => c.data.isSystem)).toBe(true);
    // ADMIN holds every permission.
    expect(created[0].data.rolePermissions.create).toHaveLength(
      ALL_PERMISSIONS.length,
    );
    expect(database.userRole.createMany).toHaveBeenCalledWith({
      data: [{ userId: 'u-resp', roleId: 'r-Admin' }],
      skipDuplicates: true,
    });
  });
});
