import { Test, TestingModule } from '@nestjs/testing';
import { ClsService } from 'nestjs-cls';
import { ActivityService } from './activity.service';
import { DatabaseService } from '../database/database.service';
import { RbacService } from '../auth/rbac/rbac.service';
import { StorageService } from '../storage/storage.service';

describe('ActivityService', () => {
  let service: ActivityService;
  let database: {
    activityLog: Record<string, jest.Mock>;
    user: Record<string, jest.Mock>;
    role: Record<string, jest.Mock>;
  };
  let rbac: { resolveSiteId: jest.Mock };
  let clsValues: Record<string, unknown>;

  const created = () =>
    (
      database.activityLog.create.mock.calls[0][0] as {
        data: { siteId: string | null; ip: string | null };
      }
    ).data;

  beforeEach(async () => {
    database = {
      activityLog: { create: jest.fn().mockResolvedValue({ id: 'log-1' }) },
      user: { findUnique: jest.fn().mockResolvedValue({ siteId: 's-author' }) },
      role: { findUnique: jest.fn() },
    };
    rbac = { resolveSiteId: jest.fn().mockResolvedValue(undefined) };
    clsValues = {};

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ActivityService,
        { provide: DatabaseService, useValue: database },
        { provide: RbacService, useValue: rbac },
        { provide: StorageService, useValue: {} },
        {
          provide: ClsService,
          useValue: {
            get: jest.fn((key: string) => clsValues[key] ?? null),
            set: jest.fn(),
          },
        },
      ],
    }).compile();

    service = module.get<ActivityService>(ActivityService);
  });

  describe('site and IP of an entry', () => {
    it("takes its object's site, and the author's IP", async () => {
      clsValues = { userId: 'u-1', ip: '192.168.1.78' };
      rbac.resolveSiteId.mockResolvedValue('s-effet');

      await service.record({
        action: 'COURRIER_VALIDE',
        entityType: 'Courrier',
        entityId: 'c-1',
      });

      expect(created()).toMatchObject({
        siteId: 's-effet',
        ip: '192.168.1.78',
      });
    });

    it("falls back to its author's site", async () => {
      clsValues = { userId: 'u-1' };

      await service.record({ action: 'POST /something' });

      expect(created().siteId).toBe('s-author');
    });

    it('keeps a global role out of every site', async () => {
      clsValues = { userId: 'u-1' };
      database.role.findUnique.mockResolvedValue({ siteId: null });

      await service.record({
        action: 'role.updated',
        entityType: 'role',
        entityId: 'r-1',
      });

      expect(created().siteId).toBeNull();
    });
  });

  it('truncates an action longer than its column (255)', async () => {
    const longUrl = `POST /courriers/${'x'.repeat(400)}/transmit`;

    await service.record({ action: longUrl });

    const { data } = database.activityLog.create.mock.calls[0][0] as {
      data: { action: string };
    };
    expect(data.action).toHaveLength(255);
    expect(data.action.endsWith('…')).toBe(true);
  });

  it('keeps a normal action untouched', async () => {
    await service.record({ action: 'dossier.created' });

    const { data } = database.activityLog.create.mock.calls[0][0] as {
      data: { action: string };
    };
    expect(data.action).toBe('dossier.created');
  });

  it('tryRecord swallows a write failure instead of failing the caller', async () => {
    database.activityLog.create.mockRejectedValue(new Error('db down'));

    await expect(service.tryRecord({ action: 'x' })).resolves.toBeNull();
  });

  it('record still throws, so explicit callers can decide', async () => {
    database.activityLog.create.mockRejectedValue(new Error('db down'));

    await expect(service.record({ action: 'x' })).rejects.toThrow('db down');
  });
});
