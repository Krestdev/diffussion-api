import { UserInstructionRole } from '../generated/prisma/client';
import { ApprovalReminderService } from './approval-reminder.service';

const DAY = 86_400_000;

// @nestjs/schedule ships as ES modules, which this Jest setup does not load: its decorators are
// replaced (the timers are not under test; run() is).
jest.mock('@nestjs/schedule', () => ({
  Cron: () => () => undefined,
}));

describe('ApprovalReminderService', () => {
  const now = new Date('2026-11-16T10:00:00.000Z');
  const ago = (days: number) => new Date(now.getTime() - days * DAY);
  let database: {
    courrier: { findMany: jest.Mock };
    livrable: { findMany: jest.Mock };
  };
  let notifications: { create: jest.Mock };
  let mail: { validatorOf: jest.Mock; dispatchValidatorsOf: jest.Mock };
  let service: ApprovalReminderService;

  beforeEach(() => {
    database = {
      courrier: { findMany: jest.fn().mockResolvedValue([]) },
      livrable: { findMany: jest.fn().mockResolvedValue([]) },
    };
    notifications = { create: jest.fn().mockResolvedValue({ id: 'n-1' }) };
    mail = {
      validatorOf: jest.fn().mockResolvedValue('validator'),
      dispatchValidatorsOf: jest
        .fn()
        .mockResolvedValue(['dispatcher', 'proposer']),
    };
    const config = {
      get: (key: string) => (key === 'REMINDER_AFTER_DAYS' ? 3 : 'test'),
    };
    service = new ApprovalReminderService(
      database as never,
      notifications as never,
      mail as never,
      config as never,
    );
  });

  // First findMany: outgoing validations; second: dispatchings.
  const courriers = (outgoing: object[], dispatch: object[] = []) =>
    database.courrier.findMany
      .mockResolvedValueOnce(outgoing)
      .mockResolvedValueOnce(dispatch);

  it("reminds an outgoing effet's validator once it waited REMINDER_AFTER_DAYS days, once per period", async () => {
    const submittedAt = ago(7);
    courriers([
      {
        id: 'c-1',
        number: 'ES-1',
        subject: 'Offre',
        dossierId: 'd-1',
        submittedAt,
        updatedAt: submittedAt,
      },
    ]);

    await expect(service.run(now)).resolves.toBe(1);

    expect(notifications.create).toHaveBeenCalledWith(
      expect.objectContaining({
        recipientIds: ['validator'],
        type: 'REMINDER_APPROVAL_STALLED',
        params: { reference: 'ES-1', title: 'Offre', days: '7' },
        courrierId: 'c-1',
      }),
      // 7 days waited, every 3 days: period 2.
      `reminder:courrier-validation:c-1:${submittedAt.getTime()}:2`,
    );
  });

  it('asks the dispatch validators, not the one who proposed it', async () => {
    const proposedAt = ago(3);
    courriers(
      [],
      [
        {
          id: 'c-2',
          number: 'EE-2',
          subject: 'Facture',
          dossierId: null,
          proposedById: 'proposer',
          proposedAt,
          updatedAt: proposedAt,
        },
      ],
    );

    await service.run(now);

    expect(notifications.create).toHaveBeenCalledWith(
      expect.objectContaining({ recipientIds: ['dispatcher'] }),
      `reminder:dispatch-validation:c-2:${proposedAt.getTime()}:1`,
    );
  });

  it("reminds a deliverable's validateur first, then its superviseur", async () => {
    const instruction = {
      id: 'i-1',
      number: 'IN-1',
      title: 'Analyser',
      status: 'EN_ATTENTE_VALIDATION',
      dossierId: 'd-1',
      courrierId: null,
      createdById: 'creator',
      assignees: [
        { role: UserInstructionRole.SUPERVISEUR, user: { id: 'sup' } },
        { role: UserInstructionRole.VALIDATEUR, user: { id: 'val' } },
      ],
    };
    courriers([]);
    database.livrable.findMany.mockResolvedValue([
      {
        id: 'l-1',
        title: 'Rapport',
        validationStep: 0,
        updatedAt: ago(4),
        instruction,
      },
      {
        id: 'l-2',
        title: 'Annexe',
        validationStep: 1,
        updatedAt: ago(4),
        instruction,
      },
    ]);

    await service.run(now);

    expect(notifications.create).toHaveBeenCalledWith(
      expect.objectContaining({
        recipientIds: ['val'],
        instructionId: 'i-1',
        params: { reference: 'IN-1', title: 'Rapport', days: '4' },
      }),
      expect.stringMatching(/^reminder:deliverable-validation:l-1:/),
    );
    expect(notifications.create).toHaveBeenCalledWith(
      expect.objectContaining({ recipientIds: ['sup'] }),
      expect.stringMatching(/^reminder:deliverable-validation:l-2:/),
    );
  });

  it('sends nothing before the delay, nor to nobody', async () => {
    mail.validatorOf.mockResolvedValue(null);
    courriers([
      {
        id: 'c-3',
        number: 'ES-3',
        subject: 'Sans validateur',
        dossierId: null,
        submittedAt: ago(5),
        updatedAt: ago(5),
      },
      {
        id: 'c-4',
        number: 'ES-4',
        subject: 'Trop tôt',
        dossierId: null,
        // Read from the database by the `lt: before` filter in real life; checked again here.
        submittedAt: ago(2),
        updatedAt: ago(2),
      },
    ]);

    await expect(service.run(now)).resolves.toBe(0);
    expect(notifications.create).not.toHaveBeenCalled();
  });

  it('does not run on its timer in tests', async () => {
    await service.hourly();
    expect(database.courrier.findMany).not.toHaveBeenCalled();
  });
});
