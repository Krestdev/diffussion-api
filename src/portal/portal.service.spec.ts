import { Test, TestingModule } from '@nestjs/testing';
import {
  CourrierDirection,
  CourrierStatus,
  NotificationStatus,
} from '../generated/prisma/client';
import { Permission } from '../auth/permissions';
import { AuthUser, CoreRequestContext } from '../auth/types/auth-user.type';
import { DatabaseService } from '../database/database.service';
import { MailService } from '../domain/mail/mail.service';
import { PortalService } from './portal.service';

const NOW = new Date('2026-11-16T10:00:00Z');
const daysAgo = (days: number) => new Date(NOW.getTime() - days * 86_400_000);

const userWith = (...permissions: string[]): AuthUser => ({
  sub: 'me',
  email: 'me@example.com',
  name: 'Awa Ndiaye',
  companyId: 'c-1',
  sid: 's-1',
  impersonator: null,
  permissions: new Set(permissions),
  platformAdmin: false,
});

const core = (language: string, currency = 'EUR') =>
  ({
    account: {
      language,
      tenant: { currency, defaultLanguage: 'fr' },
    },
  }) as unknown as CoreRequestContext;

describe('PortalService', () => {
  let service: PortalService;
  const database = {
    courrier: { count: jest.fn(), findMany: jest.fn() },
    instruction: { count: jest.fn(), findMany: jest.fn() },
    livrable: { count: jest.fn(), findMany: jest.fn() },
    delegation: { findMany: jest.fn() },
    userNotification: { findMany: jest.fn() },
  };
  const mail = { findIncoming: jest.fn() };

  beforeEach(async () => {
    jest.clearAllMocks();
    jest.useFakeTimers({ doNotFake: ['setTimeout', 'clearTimeout'] });
    jest.setSystemTime(NOW);
    for (const model of ['courrier', 'instruction', 'livrable'] as const) {
      database[model].count.mockResolvedValue(0);
      database[model].findMany.mockResolvedValue([]);
    }
    database.delegation.findMany.mockResolvedValue([]);
    database.userNotification.findMany.mockResolvedValue([]);
    mail.findIncoming.mockResolvedValue({ data: [], total: 0 });

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PortalService,
        { provide: DatabaseService, useValue: database },
        { provide: MailService, useValue: mail },
      ],
    }).compile();
    service = module.get(PortalService);
  });

  afterEach(() => jest.useRealTimers());

  it('answers contract C6 with nothing waiting', async () => {
    await expect(service.summary(userWith(), core('fr'))).resolves.toEqual({
      pending: 0,
      currency: 'EUR',
      items: [],
      delegations: [],
      notifications: [],
    });
  });

  it('counts the effets to dispatch with their age, only for a dispatcher', async () => {
    mail.findIncoming.mockImplementation(({ tab }: { tab: string }) =>
      Promise.resolve(
        tab === 'toDispatch'
          ? {
              total: 3,
              data: [
                { receivedAt: daysAgo(5), createdAt: daysAgo(1) },
                { receivedAt: null, createdAt: daysAgo(3) },
                { receivedAt: daysAgo(1), createdAt: daysAgo(1) },
              ],
            }
          : { total: 0, data: [] },
      ),
    );

    const withRight = await service.summary(
      userWith(Permission.INCOMING_DISPATCH),
      core('fr'),
    );
    expect(withRight.items).toEqual([
      {
        key: 'incomingToDispatch',
        count: 3,
        amount: null,
        late: 2,
        oldestDays: 5,
        link: '/dashboard/incoming?tab=toDispatch',
      },
    ]);
    expect(withRight.pending).toBe(3);
    expect(mail.findIncoming).toHaveBeenCalledWith(
      expect.objectContaining({ tab: 'toDispatch', sort: 'oldest' }),
      'me',
    );

    mail.findIncoming.mockClear();
    const without = await service.summary(userWith(), core('fr'));
    expect(without.items).toEqual([]);
    expect(mail.findIncoming).not.toHaveBeenCalled();
  });

  it('reads the outgoing kinds only with their permission; validation is a designation', async () => {
    database.courrier.count.mockImplementation(
      ({ where }: { where: { status?: unknown } }) =>
        Promise.resolve(
          where.status === CourrierStatus.EN_ATTENTE_VALIDATION ? 2 : 1,
        ),
    );

    const { items } = await service.summary(userWith(), core('en'));
    expect(items.map((item) => item.key)).toEqual(['outgoingToValidate']);
    expect(items[0]).toMatchObject({
      count: 2,
      link: '/dashboard/tasks?tab=outgoing',
    });

    const all = await service.summary(
      userWith(
        Permission.INCOMING_READ,
        Permission.OUTGOING_READ,
        Permission.OUTGOING_SEND,
      ),
      core('en'),
    );
    expect(all.items.map((item) => item.key)).toEqual([
      'incomingToHandle',
      'outgoingToValidate',
      'outgoingToCorrect',
      'outgoingToSend',
      'outgoingToDischarge',
    ]);
    expect(all.pending).toBe(6);
  });

  it('counts my tasks and the livrables waiting for my opinion or decision', async () => {
    database.instruction.count.mockResolvedValueOnce(2); // to subscribe
    database.instruction.count.mockResolvedValueOnce(1); // to deliver
    database.instruction.findMany.mockResolvedValueOnce([
      { assignedAt: daysAgo(4), createdAt: daysAgo(6) },
      { assignedAt: null, createdAt: daysAgo(1) },
    ]);
    database.livrable.count.mockResolvedValue(4);
    database.livrable.findMany.mockResolvedValue([{ updatedAt: daysAgo(3) }]);

    const { items } = await service.summary(userWith(), core('fr'));
    expect(items).toEqual([
      {
        key: 'tasksToSubscribe',
        count: 2,
        amount: null,
        late: 1,
        oldestDays: 4,
        link: '/dashboard/tasks?tab=instructions',
      },
      expect.objectContaining({ key: 'tasksToDeliver', count: 1 }),
      expect.objectContaining({
        key: 'livrablesToReview',
        count: 4,
        late: 1,
        oldestDays: 3,
      }),
    ]);
    // tasksToReassign needs instruction.reassign.
    expect(database.instruction.count).toHaveBeenCalledTimes(2);
  });

  it('leaves out a failing kind instead of failing the summary', async () => {
    mail.findIncoming.mockRejectedValue(new Error('database down'));
    database.livrable.count.mockResolvedValue(1);
    database.livrable.findMany.mockResolvedValue([{ updatedAt: daysAgo(0) }]);
    database.delegation.findMany.mockRejectedValue(new Error('boom'));

    const summary = await service.summary(
      userWith(
        Permission.INCOMING_DISPATCH,
        Permission.INCOMING_DISPATCH_VALIDATE,
      ),
      core('fr'),
    );
    expect(summary.items.map((item) => item.key)).toEqual([
      'livrablesToReview',
    ]);
    expect(summary.delegations).toEqual([]);
    expect(summary.pending).toBe(1);
  });

  it('maps the delegations on both sides', async () => {
    database.delegation.findMany.mockResolvedValue([
      {
        id: 'd-1',
        startDate: daysAgo(1),
        endDate: daysAgo(-3),
        delegantId: 'me',
        delegant: { id: 'me', name: 'Awa Ndiaye' },
        delegataire: { id: 'u-2', name: 'Jean Paul Mbarga' },
      },
      {
        id: 'd-2',
        startDate: daysAgo(-2),
        endDate: daysAgo(-5),
        delegantId: 'u-3',
        delegant: { id: 'u-3', name: 'Marie' },
        delegataire: { id: 'me', name: 'Awa Ndiaye' },
      },
    ]);

    const { delegations } = await service.summary(userWith(), core('fr'));
    expect(delegations).toEqual([
      {
        id: 'd-1',
        side: 'COVERED',
        status: 'ACTIVE',
        person: { id: 'u-2', firstName: 'Jean', lastName: 'Paul Mbarga' },
        startsAt: daysAgo(1),
        endsAt: daysAgo(-3),
      },
      {
        id: 'd-2',
        side: 'ACTING',
        status: 'UPCOMING',
        person: { id: 'u-3', firstName: 'Marie', lastName: '' },
        startsAt: daysAgo(-2),
        endsAt: daysAgo(-5),
      },
    ]);
  });

  it("writes the notifications' titles in the person's language, with the bell's links", async () => {
    database.userNotification.findMany.mockResolvedValue([
      {
        status: NotificationStatus.NOT_READ,
        notification: {
          id: 'n-1',
          type: 'TASK_ASSIGNED',
          message: 'Tâche T-12 : relire le rapport',
          instructionId: 'i-1',
          courrierId: null,
          dossierId: null,
          createdAt: daysAgo(0),
          courrier: null,
        },
      },
      {
        status: NotificationStatus.READ,
        notification: {
          id: 'n-2',
          type: 'UNKNOWN_TYPE',
          message: null,
          instructionId: null,
          courrierId: 'c-9',
          dossierId: null,
          createdAt: daysAgo(1),
          courrier: { direction: CourrierDirection.SORTANT },
        },
      },
    ]);

    const { notifications } = await service.summary(userWith(), core('it'));
    expect(notifications).toEqual([
      {
        id: 'n-1',
        kind: 'TASK_ASSIGNED',
        title: expect.any(String) as string,
        body: 'Tâche T-12 : relire le rapport',
        link: '/dashboard/tasks/i-1',
        readAt: null,
        createdAt: daysAgo(0),
      },
      {
        id: 'n-2',
        kind: 'UNKNOWN_TYPE',
        title: 'Notifica',
        body: 'Notifica',
        link: '/dashboard/outgoing/c-9',
        readAt: daysAgo(1),
        createdAt: daysAgo(1),
      },
    ]);
    expect(database.userNotification.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { userId: 'me', status: { not: NotificationStatus.ARCHIVED } },
        take: 5,
      }),
    );
  });

  it('falls back to XAF and English without the core context', async () => {
    const summary = await service.summary(userWith());
    expect(summary.currency).toBe('XAF');
  });
});
