import { Test, TestingModule } from '@nestjs/testing';
import { SettingsService } from '../administration/settings/settings.service';
import { DatabaseService } from '../database/database.service';
import { AutoArchiveService, monthsBefore } from './auto-archive.service';

describe('AutoArchiveService', () => {
  let service: AutoArchiveService;
  let months: Record<string, number | null>;
  let database: {
    site: Record<string, jest.Mock>;
    courrier: Record<string, jest.Mock>;
    activityLog: Record<string, jest.Mock>;
  };
  const NOW = new Date('2026-11-10T00:00:00Z');

  beforeEach(async () => {
    months = { 's-1': 6, 's-2': null };
    database = {
      site: {
        findMany: jest.fn().mockResolvedValue([{ id: 's-1' }, { id: 's-2' }]),
      },
      courrier: {
        // One closed entrant due on every rule queried.
        findMany: jest.fn().mockResolvedValue([{ id: 'c-1' }]),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      activityLog: { createMany: jest.fn().mockResolvedValue({ count: 1 }) },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AutoArchiveService,
        { provide: DatabaseService, useValue: database },
        {
          provide: SettingsService,
          useValue: {
            get: jest.fn((siteId: string | null) =>
              Promise.resolve({
                autoArchiveAfterMonths: siteId ? months[siteId] : null,
              }),
            ),
          },
        },
      ],
    }).compile();

    service = module.get(AutoArchiveService);
  });

  it('archives only the sites that set a delay, past that delay', async () => {
    await service.sweep(NOW);

    const queries = database.courrier.findMany.mock.calls.map(
      ([args]) => args as { where: Record<string, unknown> },
    );
    // Three rules (closed entrant, discharged sortant, cancelled), site s-1
    // only: s-2 and the effets of no site never auto-archive.
    expect(queries).toHaveLength(3);
    expect(queries[0].where).toMatchObject({
      status: 'CLOTURE',
      closedAt: { lt: monthsBefore(NOW, 6) },
    });
  });

  it('archives — never deletes — and keeps where it came from', async () => {
    await service.sweep(NOW);

    expect(database.courrier.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ['c-1'] }, status: 'CLOTURE' },
      data: expect.objectContaining({
        status: 'ARCHIVE',
        archivedFromStatus: 'CLOTURE',
        archiveReason: 'Archivage automatique : 6 mois après clôture',
      }),
    });
    expect(database.activityLog.createMany).toHaveBeenCalled();
  });

  it('counts months on the calendar', () => {
    expect(monthsBefore(new Date('2026-11-10T00:00:00Z'), 6)).toEqual(
      new Date('2026-05-10T00:00:00Z'),
    );
  });
});
