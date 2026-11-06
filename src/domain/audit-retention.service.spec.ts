import { Test, TestingModule } from '@nestjs/testing';
import { SettingsService } from '../administration/settings/settings.service';
import { DatabaseService } from '../database/database.service';
import { StorageService } from '../storage/storage.service';
import { AuditRetentionService } from './audit-retention.service';

const NOW = new Date('2026-11-10T00:00:00Z');

const entry = (id: string, createdAt: string) => ({
  id,
  createdAt: new Date(createdAt),
  siteId: 's-1',
  userId: 'u-1',
  actorLabel: 'a@b.c',
  source: 'USER',
  level: 'info',
  action: 'COURRIER_VALIDE',
  entityType: 'Courrier',
  entityId: 'c-1',
  message: 'Validé; "ok"',
  ip: '10.0.0.1',
  parentLogId: null,
  metadata: { a: 1 },
  stack: null,
});

describe('AuditRetentionService', () => {
  let service: AuditRetentionService;
  let database: {
    site: Record<string, jest.Mock>;
    activityLog: Record<string, jest.Mock>;
    auditArchive: Record<string, jest.Mock>;
  };
  let storage: { upload: jest.Mock };
  let retention: Record<string, number>;

  beforeEach(async () => {
    retention = { 's-1': 2 };
    database = {
      site: { findMany: jest.fn().mockResolvedValue([{ id: 's-1' }]) },
      activityLog: {
        findMany: jest
          .fn()
          .mockResolvedValueOnce([
            entry('l-1', '2023-01-05T10:00:00Z'),
            entry('l-2', '2024-03-01T10:00:00Z'),
          ])
          .mockResolvedValue([]),
        deleteMany: jest.fn().mockResolvedValue({ count: 2 }),
        create: jest.fn().mockResolvedValue({}),
      },
      auditArchive: { create: jest.fn().mockResolvedValue({ id: 'ar-1' }) },
    };
    storage = { upload: jest.fn().mockResolvedValue({ key: 'k/1.csv' }) };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuditRetentionService,
        { provide: DatabaseService, useValue: database },
        { provide: StorageService, useValue: storage },
        {
          provide: SettingsService,
          useValue: {
            get: jest.fn((siteId: string | null) =>
              Promise.resolve({
                auditRetentionYears: siteId ? retention[siteId] : 10,
              }),
            ),
          },
        },
      ],
    }).compile();

    service = module.get(AuditRetentionService);
  });

  it("exports a site's entries past its retention, then deletes them", async () => {
    await service.sweep(NOW);

    expect(database.activityLog.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          siteId: 's-1',
          createdAt: { lt: new Date('2024-11-10T00:00:00Z') },
        },
      }),
    );
    const csv = (storage.upload.mock.calls[0][0] as Buffer).toString();
    expect(csv).toContain('id;createdAt;siteId');
    // A cell with ; or " is quoted.
    expect(csv).toContain('"Validé; ""ok"""');
    expect(database.auditArchive.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        siteId: 's-1',
        storageKey: 'k/1.csv',
        entries: 2,
        retentionYears: 2,
      }),
    });
    expect(database.activityLog.deleteMany).toHaveBeenCalledWith({
      where: { id: { in: ['l-1', 'l-2'] } },
    });
  });

  it('deletes nothing when the file could not be stored', async () => {
    storage.upload.mockRejectedValue(new Error('RustFS down'));

    await service.sweep(NOW);

    expect(database.activityLog.deleteMany).not.toHaveBeenCalled();
  });

  it('keeps one year at least, whatever the settings', async () => {
    retention['s-1'] = 0;

    await service.sweep(NOW);

    expect(database.activityLog.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          siteId: 's-1',
          createdAt: { lt: new Date('2025-11-10T00:00:00Z') },
        },
      }),
    );
  });
});
