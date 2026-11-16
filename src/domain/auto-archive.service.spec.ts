import { Test, TestingModule } from '@nestjs/testing';
import { SettingsService } from '../administration/settings/settings.service';
import { DatabaseService } from '../database/database.service';
import { WorkflowService } from '../workflow/workflow.service';
import { AutoArchiveService, monthsBefore } from './auto-archive.service';

describe('AutoArchiveService', () => {
  let service: AutoArchiveService;
  let months: Record<string, number | null>;
  let database: {
    company: Record<string, jest.Mock>;
    courrier: Record<string, jest.Mock>;
    activityLog: Record<string, jest.Mock>;
    statusHistory: Record<string, jest.Mock>;
    $transaction: jest.Mock;
  };
  const NOW = new Date('2026-11-10T00:00:00Z');

  beforeEach(async () => {
    months = { 's-1': 6, 's-2': null };
    database = {
      company: {
        findMany: jest.fn().mockResolvedValue([{ id: 's-1' }, { id: 's-2' }]),
      },
      courrier: {
        // One closed entrant due on every rule queried.
        findMany: jest
          .fn()
          .mockResolvedValue([{ id: 'c-1', direction: 'ENTRANT' }]),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      activityLog: { createMany: jest.fn().mockResolvedValue({ count: 1 }) },
      statusHistory: { create: jest.fn().mockResolvedValue({}) },
      $transaction: jest.fn((work: (tx: unknown) => unknown) =>
        Promise.resolve(work(database)),
      ),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AutoArchiveService,
        WorkflowService,
        { provide: DatabaseService, useValue: database },
        {
          provide: SettingsService,
          useValue: {
            get: jest.fn((companyId: string | null) =>
              Promise.resolve({
                autoArchiveAfterMonths: companyId ? months[companyId] : null,
              }),
            ),
          },
        },
      ],
    }).compile();

    service = module.get(AutoArchiveService);
  });

  it('archives only the companies that set a delay, past that delay', async () => {
    await service.sweep(NOW);

    const queries = database.courrier.findMany.mock.calls.map(
      ([args]) => args as { where: Record<string, unknown> },
    );
    // Three rules (closed entrant, discharged sortant, cancelled), company s-1
    // only: s-2 and the effets of no company never auto-archive.
    expect(queries).toHaveLength(3);
    expect(queries[0].where).toMatchObject({
      status: 'CLOTURE',
      closedAt: { lt: monthsBefore(NOW, 6) },
    });
  });

  it('archives — never deletes — and keeps where it came from', async () => {
    await service.sweep(NOW);

    expect(database.courrier.updateMany).toHaveBeenCalledWith({
      where: { id: 'c-1', status: 'CLOTURE' },
      data: expect.objectContaining({
        status: 'ARCHIVE',
        archivedFromStatus: 'CLOTURE',
        archiveReason: 'Archivage automatique : 6 mois après clôture',
      }),
    });
    expect(database.activityLog.createMany).toHaveBeenCalled();
    // Each change is the system's own, in StatusHistory.
    expect(database.statusHistory.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        entity: 'Courrier',
        entityId: 'c-1',
        fromStatus: 'CLOTURE',
        toStatus: 'ARCHIVE',
        event: 'AUTO_ARCHIVE',
        actorId: null,
        companyId: 's-1',
      }),
    });
  });

  it('leaves an effet that changed meanwhile, and archives the others', async () => {
    // Two closed entrants due, nothing on the other rules.
    database.courrier.findMany
      .mockResolvedValueOnce([
        { id: 'c-1', direction: 'ENTRANT' },
        { id: 'c-2', direction: 'ENTRANT' },
      ])
      .mockResolvedValue([]);
    database.courrier.updateMany
      .mockResolvedValueOnce({ count: 0 })
      .mockResolvedValue({ count: 1 });
    const archived = await service.archiveCompany(
      's-1',
      monthsBefore(NOW, 6),
      6,
      NOW,
    );
    // c-1 changed meanwhile (skipped); c-2 archived, and journalled alone.
    expect(archived).toBe(1);
    expect(database.activityLog.createMany.mock.calls[0][0].data).toEqual([
      expect.objectContaining({ entityId: 'c-2' }),
    ]);
  });

  it('counts months on the calendar', () => {
    expect(monthsBefore(new Date('2026-11-10T00:00:00Z'), 6)).toEqual(
      new Date('2026-05-10T00:00:00Z'),
    );
  });
});
