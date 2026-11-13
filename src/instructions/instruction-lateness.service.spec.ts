import { Test, TestingModule } from '@nestjs/testing';
import { DatabaseService } from '../database/database.service';
import { NotificationsService } from '../notifications/notifications.service';
import { InstructionLatenessService } from './instruction-lateness.service';

describe('InstructionLatenessService', () => {
  let service: InstructionLatenessService;
  let database: { instruction: Record<string, jest.Mock> };
  let notifications: { create: jest.Mock };

  // Created by creator-1, supervised by u-sup, executed by u-exec.
  const overdueTask = {
    id: 'i-1',
    title: 'Rédiger le rapport',
    dossierId: 'd-1',
    courrierId: null,
    createdById: 'creator-1',
    dueDate: new Date('2026-10-20'),
    agentDueDate: new Date('2026-10-15'),
    assignees: [
      { userId: 'u-exec', role: 'EXECUTANT' },
      { userId: 'u-sup', role: 'SUPERVISEUR' },
    ],
  };

  beforeEach(async () => {
    database = {
      instruction: {
        findMany: jest.fn(),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
    };
    notifications = { create: jest.fn().mockResolvedValue({}) };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        InstructionLatenessService,
        { provide: DatabaseService, useValue: database },
        { provide: NotificationsService, useValue: notifications },
      ],
    }).compile();

    service = module.get(InstructionLatenessService);
  });

  it("alerts the executants and the superviseur when the executants' deadline passes", async () => {
    database.instruction.findMany
      .mockResolvedValueOnce([overdueTask])
      .mockResolvedValueOnce([]);

    await service.sweep(new Date('2026-10-28'));

    expect(notifications.create).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'TASK_OVERDUE_AGENT',
        recipientIds: ['u-exec', 'u-sup'],
        instructionId: 'i-1',
      }),
    );
  });

  it("alerts the superviseur and the creator when the task's deadline passes", async () => {
    database.instruction.findMany
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([overdueTask]);

    await service.sweep(new Date('2026-10-28'));

    expect(notifications.create).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'TASK_OVERDUE',
        recipientIds: ['u-sup', 'creator-1'],
      }),
    );
  });

  it('sends nothing when another instance already sent the alert', async () => {
    database.instruction.findMany
      .mockResolvedValueOnce([overdueTask])
      .mockResolvedValueOnce([overdueTask]);
    database.instruction.updateMany.mockResolvedValue({ count: 0 });

    await service.sweep(new Date('2026-10-28'));

    expect(notifications.create).not.toHaveBeenCalled();
  });
});
