import { Test, TestingModule } from '@nestjs/testing';
import { ClsService } from 'nestjs-cls';
import { ActivityService } from './activity.service';
import { DatabaseService } from '../database/database.service';

describe('ActivityService', () => {
  let service: ActivityService;
  let database: { activityLog: Record<string, jest.Mock> };

  beforeEach(async () => {
    database = {
      activityLog: { create: jest.fn().mockResolvedValue({ id: 'log-1' }) },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ActivityService,
        { provide: DatabaseService, useValue: database },
        {
          provide: ClsService,
          useValue: { get: jest.fn().mockReturnValue(null), set: jest.fn() },
        },
      ],
    }).compile();

    service = module.get<ActivityService>(ActivityService);
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
