import { Test, TestingModule } from '@nestjs/testing';
import { CourrierStatus } from '../../generated/prisma/client';
import { PermissionCode } from '../auth/rbac/rbac.constants';
import { RbacService } from '../auth/rbac/rbac.service';
import { DatabaseService } from '../database/database.service';
import { DashboardService } from './dashboard.service';

describe('DashboardService', () => {
  let service: DashboardService;
  const database = {
    $transaction: jest.fn((queries: Promise<number>[]) => Promise.all(queries)),
    instruction: { count: jest.fn() },
    courrier: { count: jest.fn(), findMany: jest.fn() },
  };
  const rbac = {
    getPermissionCodes: jest.fn(),
    // Global grant: no site restriction.
    siteFilter: jest.fn().mockResolvedValue({}),
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    jest.useFakeTimers().setSystemTime(new Date('2026-09-28T10:00:00Z'));
    database.instruction.count
      .mockResolvedValueOnce(4)
      .mockResolvedValueOnce(9)
      .mockResolvedValueOnce(1);
    // 2 courriers await my validation; the courrier section counts 12
    // received, then 3 archived.
    const sectionCounts = [12, 3];
    database.courrier.count.mockImplementation(
      ({ where }: { where: { status?: unknown } }) =>
        Promise.resolve(
          where.status === CourrierStatus.EN_ATTENTE_VALIDATION
            ? 2
            : sectionCounts.shift(),
        ),
    );

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DashboardService,
        { provide: DatabaseService, useValue: database },
        { provide: RbacService, useValue: rbac },
      ],
    }).compile();
    service = module.get(DashboardService);
  });

  afterEach(() => jest.useRealTimers());

  it('hides courrier sections without COURRIER_READ', async () => {
    rbac.getPermissionCodes.mockResolvedValue([]);

    const stats = await service.getStats('u1', {});

    expect(stats).toEqual({
      tasks: { todo: 4, completed: 9, overdue: 1 },
      approvals: { awaitingMyDecision: 2 },
      courriers: null,
      trend: null,
    });
    expect(database.courrier.findMany).not.toHaveBeenCalled();
  });

  it('buckets incoming courriers per local day, oldest first', async () => {
    rbac.getPermissionCodes.mockResolvedValue([PermissionCode.CourrierRead]);
    database.courrier.findMany.mockResolvedValue([
      // 23:30 UTC on the 27th is already the 28th in Douala (UTC+1).
      { receivedAt: new Date('2026-09-27T23:30:00Z'), createdAt: new Date() },
      // No receivedAt: falls back to createdAt.
      { receivedAt: null, createdAt: new Date('2026-09-22T12:00:00Z') },
      // Older than the 7-day window: dropped.
      { receivedAt: new Date('2026-09-20T12:00:00Z'), createdAt: new Date() },
    ]);

    const stats = await service.getStats('u1', {
      days: 7,
      tz: 'Africa/Douala',
    });

    expect(stats.courriers).toEqual({ received: 12, archived: 3 });
    expect(stats.trend).toEqual({
      days: 7,
      timeZone: 'Africa/Douala',
      points: [
        { date: '2026-09-22', count: 1 },
        { date: '2026-09-23', count: 0 },
        { date: '2026-09-24', count: 0 },
        { date: '2026-09-25', count: 0 },
        { date: '2026-09-26', count: 0 },
        { date: '2026-09-27', count: 0 },
        { date: '2026-09-28', count: 1 },
      ],
    });
  });

  it('returns 30 points for the 30-day period', async () => {
    rbac.getPermissionCodes.mockResolvedValue([PermissionCode.CourrierRead]);
    database.courrier.findMany.mockResolvedValue([]);

    const stats = await service.getStats('u1', { days: 30 });

    expect(stats.trend?.points).toHaveLength(30);
    expect(stats.trend?.points[0].date).toBe('2026-08-30');
    expect(stats.trend?.points[29].date).toBe('2026-09-28');
  });
});
