import { Test, TestingModule } from '@nestjs/testing';
import { SettingsService } from '../administration/settings/settings.service';
import { RbacService } from '../auth/rbac/rbac.service';
import { DatabaseService } from '../database/database.service';
import { NotificationsService } from '../notifications/notifications.service';
import { DeadlineReminderService } from './deadline-reminder.service';

const NOW = new Date('2026-11-10T10:00:00Z');
const DAY = 24 * 3600 * 1000;

const effet = (over: Record<string, unknown> = {}) => ({
  id: 'c-1',
  number: 'M-1',
  subject: 'Demande',
  direction: 'ENTRANT',
  dossierId: null,
  ownerId: 'u-owner',
  supervisorId: 'u-sup',
  createdById: 'u-agent',
  transmittedById: null,
  dueDate: null,
  supervisorDueDate: null,
  dischargeDueDate: null,
  overdueRemindedAt: null,
  dischargeRemindedAt: null,
  dossier: null,
  createdBy: { siteId: 's-1' },
  ...over,
});

describe('DeadlineReminderService', () => {
  let service: DeadlineReminderService;
  let settings: {
    reminderDaysBefore: number;
    overdueReminderFrequency: string | null;
    remindDesignatedResponsible: boolean;
  };
  let courriers: {
    dueSoon: unknown[];
    overdue: unknown[];
    discharge: unknown[];
  };
  let database: {
    courrier: Record<string, jest.Mock>;
    instruction: Record<string, jest.Mock>;
  };
  let notifications: { create: jest.Mock };

  const sent = () =>
    notifications.create.mock.calls.map(
      ([dto]) => dto as { type: string; recipientIds: string[] },
    );

  beforeEach(async () => {
    settings = {
      reminderDaysBefore: 2,
      overdueReminderFrequency: 'DAILY',
      remindDesignatedResponsible: false,
    };
    courriers = { dueSoon: [], overdue: [], discharge: [] };
    database = {
      courrier: {
        // dueSoon, overdue, discharge — in the sweep's order.
        findMany: jest.fn(({ where }: { where: Record<string, unknown> }) =>
          Promise.resolve(
            'dueReminderSentAt' in where
              ? courriers.dueSoon
              : 'dischargeDueDate' in where
                ? courriers.discharge
                : courriers.overdue,
          ),
        ),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      instruction: {
        findMany: jest.fn().mockResolvedValue([]),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
    };
    notifications = { create: jest.fn().mockResolvedValue(null) };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DeadlineReminderService,
        { provide: DatabaseService, useValue: database },
        { provide: NotificationsService, useValue: notifications },
        {
          provide: SettingsService,
          useValue: { get: jest.fn(() => Promise.resolve(settings)) },
        },
        {
          provide: RbacService,
          useValue: { resolveSiteId: jest.fn().mockResolvedValue('s-1') },
        },
      ],
    }).compile();

    service = module.get(DeadlineReminderService);
  });

  it('reminds an effet whose deadline is within the reminder delay', async () => {
    courriers.dueSoon = [
      effet({ dueDate: new Date(NOW.getTime() + 1.5 * DAY) }),
      // Too far: 5 days away, with a 2-day reminder.
      effet({ id: 'c-2', dueDate: new Date(NOW.getTime() + 5 * DAY) }),
    ];

    await service.sweep(NOW);

    expect(sent()).toEqual([
      expect.objectContaining({
        type: 'COURRIER_DUE_SOON',
        recipientIds: ['u-sup'],
      }),
    ]);
  });

  it('alerts an overdue effet, then relaunches it at the frequency', async () => {
    courriers.overdue = [
      // Never alerted: alerted now.
      effet({ dueDate: new Date(NOW.getTime() - DAY) }),
      // Alerted 2 days ago, daily: relaunched.
      effet({
        id: 'c-2',
        dueDate: new Date(NOW.getTime() - 3 * DAY),
        overdueRemindedAt: new Date(NOW.getTime() - 2 * DAY),
      }),
      // Alerted 3 hours ago: not yet.
      effet({
        id: 'c-3',
        dueDate: new Date(NOW.getTime() - DAY),
        overdueRemindedAt: new Date(NOW.getTime() - 3 * 3600 * 1000),
      }),
    ];

    await service.sweep(NOW);

    expect(sent().filter((n) => n.type === 'COURRIER_OVERDUE')).toHaveLength(2);
  });

  it('never relaunches when the site turned relaunches off', async () => {
    settings.overdueReminderFrequency = null;
    courriers.overdue = [
      effet({
        dueDate: new Date(NOW.getTime() - 5 * DAY),
        overdueRemindedAt: new Date(NOW.getTime() - 4 * DAY),
      }),
    ];

    await service.sweep(NOW);

    expect(sent()).toHaveLength(0);
  });

  it('also tells the designated responsible when the site says so', async () => {
    settings.remindDesignatedResponsible = true;
    courriers.overdue = [effet({ dueDate: new Date(NOW.getTime() - DAY) })];

    await service.sweep(NOW);

    expect(sent()[0].recipientIds).toEqual(['u-sup', 'u-owner']);
  });

  it("alerts a sortant's late discharge to its author and sender", async () => {
    courriers.discharge = [
      effet({
        direction: 'SORTANT',
        createdById: 'u-author',
        transmittedById: 'u-sender',
        dischargeDueDate: new Date(NOW.getTime() - DAY),
      }),
    ];

    await service.sweep(NOW);

    expect(sent()).toEqual([
      expect.objectContaining({
        type: 'COURRIER_DISCHARGE_OVERDUE',
        recipientIds: ['u-author', 'u-sender'],
      }),
    ]);
  });

  it('sends nothing another API instance claimed first', async () => {
    database.courrier.updateMany.mockResolvedValue({ count: 0 });
    courriers.overdue = [effet({ dueDate: new Date(NOW.getTime() - DAY) })];

    await service.sweep(NOW);

    expect(sent()).toHaveLength(0);
  });
});
