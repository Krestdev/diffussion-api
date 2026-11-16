import { DigestService } from './digest.service';

// @nestjs/schedule ships as ES modules, which this Jest setup does not load: its decorators are
// replaced (the timers are not under test; run() is).
jest.mock('@nestjs/schedule', () => ({
  Cron: () => () => undefined,
}));

describe('DigestService', () => {
  const now = new Date('2026-11-16T07:00:00.000Z');
  let database: { userNotification: { groupBy: jest.Mock } };
  let notifications: { create: jest.Mock };
  let service: DigestService;

  beforeEach(() => {
    database = { userNotification: { groupBy: jest.fn() } };
    notifications = { create: jest.fn().mockResolvedValue({ id: 'n-1' }) };
    service = new DigestService(
      database as never,
      notifications as never,
      { get: () => 'test' } as never,
    );
  });

  it("sums up each user's unread to-do notifications once a day", async () => {
    database.userNotification.groupBy.mockResolvedValue([
      { userId: 'u-1', _count: { _all: 3 } },
      { userId: 'u-2', _count: { _all: 1 } },
    ]);

    await expect(service.run(now)).resolves.toBe(2);

    const [query] = database.userNotification.groupBy.mock.calls[0] as [
      { where: { status: string; notification: { type: { in: string[] } } } },
    ];
    expect(query.where.status).toBe('NOT_READ');
    expect(query.where.notification.type.in).toContain('TASK_ASSIGNED');
    expect(notifications.create).toHaveBeenCalledWith(
      expect.objectContaining({
        recipientIds: ['u-1'],
        type: 'DAILY_DIGEST',
        params: { count: '3' },
      }),
      'digest:2026-11-16:u-1',
    );
    expect(notifications.create).toHaveBeenCalledWith(
      expect.objectContaining({
        recipientIds: ['u-2'],
        params: { count: '1' },
      }),
      'digest:2026-11-16:u-2',
    );
  });

  it('counts nothing already sent today (same source)', async () => {
    database.userNotification.groupBy.mockResolvedValue([
      { userId: 'u-1', _count: { _all: 2 } },
    ]);
    notifications.create.mockResolvedValue(null);

    await expect(service.run(now)).resolves.toBe(0);
  });

  it('does not run on its timer in tests', async () => {
    await service.morning();
    expect(database.userNotification.groupBy).not.toHaveBeenCalled();
  });
});
