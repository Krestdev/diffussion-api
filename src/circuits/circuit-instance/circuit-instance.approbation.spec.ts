import { Test, TestingModule } from '@nestjs/testing';
import { CircuitInstanceService } from './circuit-instance.service';
import { DatabaseService } from '../../database/database.service';
import { NotificationsService } from '../../notifications/notifications.service';
import { RbacService } from '../../auth/rbac/rbac.service';
import {
  CircuitInstanceStatus,
  CourrierDirection,
  DossierPriority,
  ValidationDecision,
} from '../../../generated/prisma/client';

describe('CircuitInstanceService.findApprobation', () => {
  let service: CircuitInstanceService;
  const database = {
    circuitInstance: { findMany: jest.fn(), count: jest.fn() },
  };
  const rbac = { eligibleRoleSitePairs: jest.fn() };

  // count() calls in order: filtered total, then pending/accepted/rejected.
  function whereOfCount(index: number) {
    return database.circuitInstance.count.mock.calls[index][0].where;
  }

  beforeEach(async () => {
    jest.clearAllMocks();
    database.circuitInstance.findMany.mockResolvedValue([{ id: 'ci-1' }]);
    database.circuitInstance.count.mockResolvedValue(0);
    rbac.eligibleRoleSitePairs.mockResolvedValue([
      { roleId: 'r-1', siteId: 's-1' },
    ]);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CircuitInstanceService,
        { provide: DatabaseService, useValue: database },
        { provide: NotificationsService, useValue: {} },
        { provide: RbacService, useValue: rbac },
      ],
    }).compile();
    service = module.get(CircuitInstanceService);
  });

  it('returns one tab of rows plus every tab count', async () => {
    database.circuitInstance.count
      .mockResolvedValueOnce(1) // filtered total
      .mockResolvedValueOnce(5) // pending
      .mockResolvedValueOnce(3) // accepted
      .mockResolvedValueOnce(2); // rejected

    const result = await service.findApprobation({ skip: 0, take: 20 }, 'u-1');

    expect(result).toEqual({
      data: [{ id: 'ci-1' }],
      total: 1,
      skip: 0,
      take: 20,
      metrics: { pending: 5, accepted: 3, rejected: 2 },
    });
  });

  it('pending = in progress, current step role held at the target site', async () => {
    await service.findApprobation({}, 'u-1');

    const pending = whereOfCount(1);
    expect(pending.status).toBe(CircuitInstanceStatus.IN_PROGRESS);
    expect(pending.OR).toEqual([
      {
        currentStep: { roleId: 'r-1' },
        OR: [
          { courrier: { dossier: { siteId: 's-1' } } },
          { document: { dossier: { siteId: 's-1' } } },
        ],
      },
    ]);
  });

  it('accepted/rejected = decisions the caller recorded', async () => {
    await service.findApprobation({ tab: 'rejected' }, 'u-1');

    expect(whereOfCount(2)).toEqual({
      validations: {
        some: {
          validatorId: 'u-1',
          decision: { in: [ValidationDecision.VALIDE] },
        },
      },
    });
    const { where } = database.circuitInstance.findMany.mock.calls[0][0];
    expect(where.AND[0]).toEqual({
      validations: {
        some: {
          validatorId: 'u-1',
          decision: {
            in: [
              ValidationDecision.REJETE,
              ValidationDecision.CORRECTIONS_DEMANDEES,
            ],
          },
        },
      },
    });
  });

  it('applies search, type, priority and date filters to the rows only', async () => {
    await service.findApprobation(
      {
        search: 'raccord',
        targetType: 'COURRIER_SORTANT',
        priority: DossierPriority.URGENT,
        createdTo: '2026-09-30',
      },
      'u-1',
    );

    const { where } = database.circuitInstance.findMany.mock.calls[0][0];
    const [, , search, type, priority, created] = where.AND;
    expect(search.OR).toHaveLength(6);
    expect(type).toEqual({
      courrier: { direction: CourrierDirection.SORTANT },
    });
    expect(priority).toEqual({ dossier: { priority: DossierPriority.URGENT } });
    expect(created.OR[0]).toEqual({
      courrier: { createdAt: { lt: new Date('2026-10-01') } },
    });
    // Tab counts ignore the filters.
    expect(whereOfCount(1)).not.toHaveProperty('AND');
  });

  it('pending is empty without querying when the caller holds no role', async () => {
    rbac.eligibleRoleSitePairs.mockResolvedValue([]);

    const result = await service.findApprobation({ tab: 'pending' }, 'u-1');

    expect(result.data).toEqual([]);
    expect(result.total).toBe(0);
    expect(result.metrics.pending).toBe(0);
    expect(database.circuitInstance.findMany).not.toHaveBeenCalled();
  });
});
