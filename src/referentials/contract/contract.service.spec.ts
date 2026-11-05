import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, ConflictException } from '@nestjs/common';
import { ActivityService } from '../../activity/activity.service';
import { RbacService } from '../../auth/rbac/rbac.service';
import { DatabaseService } from '../../database/database.service';
import { ContractService } from './contract.service';

describe('ContractService', () => {
  let service: ContractService;
  let database: {
    contract: Record<string, jest.Mock>;
    project: Record<string, jest.Mock>;
    dossier: Record<string, jest.Mock>;
    document: Record<string, jest.Mock>;
    courrier: Record<string, jest.Mock>;
    $transaction: jest.Mock;
  };

  beforeEach(async () => {
    database = {
      contract: {
        create: jest.fn().mockResolvedValue({
          id: 'c-new',
          _count: { dossiers: 0, accesses: 0 },
        }),
        findUnique: jest.fn(),
        update: jest.fn().mockResolvedValue({ id: 'c-1' }),
        count: jest.fn().mockResolvedValue(1),
        delete: jest.fn(),
      },
      project: {
        findUnique: jest.fn().mockResolvedValue({ id: 'p-1', siteId: 's-1' }),
      },
      dossier: {
        updateMany: jest.fn(),
        findMany: jest.fn().mockResolvedValue([]),
      },
      document: { count: jest.fn().mockResolvedValue(0) },
      courrier: { findMany: jest.fn().mockResolvedValue([]) },
      $transaction: jest.fn((fn: (tx: unknown) => unknown) => fn(database)),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ContractService,
        { provide: DatabaseService, useValue: database },
        {
          provide: ActivityService,
          useValue: { tryRecord: jest.fn().mockResolvedValue('log-1') },
        },
        {
          provide: RbacService,
          useValue: {
            hasGlobalPermission: jest.fn().mockResolvedValue(false),
            managedSites: jest.fn().mockResolvedValue('ALL'),
          },
        },
      ],
    }).compile();

    service = module.get<ContractService>(ContractService);
  });

  const existing = (over: Record<string, unknown> = {}) => ({
    id: 'c-1',
    projectId: 'p-1',
    status: 'ACTIVE',
    clientId: null,
    responsibleId: null,
    startDate: null,
    endDate: null,
    _count: { dossiers: 0, accesses: 0 },
    dossiers: [],
    ...over,
  });

  it('creates a contract under an existing project', async () => {
    await service.create({ title: 'Marché A', projectId: 'p-1' }, 'u-admin');

    expect(database.contract.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ title: 'Marché A', projectId: 'p-1' }),
      }),
    );
  });

  it('refuses an unknown project', async () => {
    database.project.findUnique.mockResolvedValue(null);

    await expect(
      service.create({ title: 'Marché A', projectId: 'p-x' }, 'u-admin'),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('refuses a contract that ends before it starts', async () => {
    await expect(
      service.create(
        {
          title: 'Marché A',
          startDate: '2026-12-01',
          endDate: '2026-11-01',
        },
        'u-admin',
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('moves its dossiers when the contract changes project', async () => {
    database.contract.findUnique.mockResolvedValue(existing());

    await service.update('c-1', { projectId: 'p-2' }, 'u-admin');

    expect(database.dossier.updateMany).toHaveBeenCalledWith({
      where: { contractId: 'c-1' },
      data: { projectId: 'p-2' },
    });
  });

  it('leaves the dossiers alone when the project is unchanged', async () => {
    database.contract.findUnique.mockResolvedValue(existing());

    await service.update('c-1', { title: 'Renamed' }, 'u-admin');

    expect(database.dossier.updateMany).not.toHaveBeenCalled();
  });

  it('refuses to delete a contract that still contains dossiers', async () => {
    database.contract.findUnique.mockResolvedValue(
      existing({ _count: { dossiers: 2, accesses: 0 } }),
    );

    await expect(service.remove('c-1', 'u-admin')).rejects.toBeInstanceOf(
      ConflictException,
    );
    expect(database.contract.delete).not.toHaveBeenCalled();
  });

  it('refuses to delete a contract that still has documents', async () => {
    database.contract.findUnique.mockResolvedValue(existing());
    database.document.count.mockResolvedValue(1);

    await expect(service.remove('c-1', 'u-admin')).rejects.toBeInstanceOf(
      ConflictException,
    );
  });

  it('freezes an archived contract', async () => {
    database.contract.findUnique.mockResolvedValue(
      existing({ status: 'ARCHIVED' }),
    );

    await expect(
      service.update('c-1', { title: 'Renamed' }, 'u-admin'),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('keeps the reason when archiving', async () => {
    database.contract.findUnique.mockResolvedValue(existing());

    await service.archive('c-1', 'u-admin', 'Marché soldé');

    expect(database.contract.update).toHaveBeenCalledWith({
      where: { id: 'c-1' },
      data: expect.objectContaining({
        status: 'ARCHIVED',
        archiveReason: 'Marché soldé',
      }),
    });
  });

  it('counts the courriers dispatched to it or in its dossiers', async () => {
    database.contract.findUnique.mockResolvedValue(existing());
    database.courrier.findMany.mockResolvedValue([
      { contractId: 'c-1', dossier: null },
      { contractId: null, dossier: { contractId: 'c-1' } },
      { contractId: 'c-1', dossier: { contractId: 'c-1' } },
      { contractId: null, dossier: { contractId: 'c-other' } },
    ]);

    const contract = await service.findOne('c-1');

    expect(contract._count).toEqual({
      dossiers: 0,
      authorized: 0,
      courriers: 3,
    });
  });

  it('lists the contract types with their labels', () => {
    expect(service.types()).toContainEqual({
      value: 'TRAVAUX',
      label: 'Travaux',
    });
  });
});
