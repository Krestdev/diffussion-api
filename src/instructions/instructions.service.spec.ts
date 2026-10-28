import { Test, TestingModule } from '@nestjs/testing';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { InstructionsService } from './instructions.service';
import { DatabaseService } from '../database/database.service';
import { NotificationsService } from '../notifications/notifications.service';
import { InstructionStatus } from '../../generated/prisma/client';

// Dossier-state rules (RG-DOS-007, site activity, progress) are covered by
// the DossierService spec; here they're stubbed so fixtures don't need a
// full dossier/site graph.
jest.mock('../common/utils/dossier-lifecycle', () => ({
  assertDossierOpenForActivity: jest.fn(),
  markDossierInProgress: jest.fn(),
  refreshDossierProgress: jest.fn(),
}));

describe('InstructionsService', () => {
  let service: InstructionsService;
  let notifications: { create: jest.Mock };
  let database: {
    instruction: Record<string, jest.Mock>;
    livrable: Record<string, jest.Mock>;
    userInstructions: Record<string, jest.Mock>;
    instructionSubscription: Record<string, jest.Mock>;
    dossierAccess: Record<string, jest.Mock>;
    courrierAccess: Record<string, jest.Mock>;
    $transaction: jest.Mock;
  };

  beforeEach(async () => {
    database = {
      instruction: {
        create: jest.fn(),
        findUnique: jest.fn(),
        findMany: jest.fn(),
        count: jest.fn(),
        update: jest.fn(),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      livrable: { count: jest.fn() },
      userInstructions: { delete: jest.fn() },
      instructionSubscription: { create: jest.fn() },
      dossierAccess: { upsert: jest.fn() },
      courrierAccess: { upsert: jest.fn() },
      // Array form (batched writes) or callback form (interactive).
      $transaction: jest.fn((arg: unknown) =>
        typeof arg === 'function'
          ? (arg as (tx: unknown) => unknown)(database)
          : Promise.all(arg as unknown[]),
      ),
    };
    notifications = { create: jest.fn().mockResolvedValue({}) };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        InstructionsService,
        { provide: DatabaseService, useValue: database },
        { provide: NotificationsService, useValue: notifications },
      ],
    }).compile();

    service = module.get<InstructionsService>(InstructionsService);
  });

  it('is defined', () => {
    expect(service).toBeDefined();
  });

  describe('create', () => {
    it('waits for its executants to subscribe to it (AFFECTEE)', async () => {
      database.instruction.create.mockResolvedValue({
        id: 'i-1',
        dossierId: 'd-1',
      });

      await service.create(
        { dossierId: 'd-1', title: 'X', executantIds: ['u-1'] },
        'creator-1',
      );

      expect(database.instruction.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: InstructionStatus.AFFECTEE }),
        }),
      );
    });

    it('stays A_AFFECTER with only a superviseur, until executants are designated', async () => {
      database.instruction.create.mockResolvedValue({
        id: 'i-1',
        dossierId: 'd-1',
      });

      await service.create(
        { dossierId: 'd-1', title: 'X', superviseurId: 'u-sup' },
        'creator-1',
      );

      expect(database.instruction.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status: InstructionStatus.A_AFFECTER,
          }),
        }),
      );
    });

    it('starts A_AFFECTER with no assignees', async () => {
      database.instruction.create.mockResolvedValue({
        id: 'i-1',
        dossierId: 'd-1',
      });

      await service.create({ dossierId: 'd-1', title: 'X' }, 'creator-1');

      expect(database.instruction.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status: InstructionStatus.A_AFFECTER,
          }),
        }),
      );
      expect(database.dossierAccess.upsert).not.toHaveBeenCalled();
    });

    it('creates initial livrables along with the instruction', async () => {
      database.instruction.create.mockResolvedValue({
        id: 'i-1',
        dossierId: 'd-1',
      });

      await service.create(
        {
          dossierId: 'd-1',
          title: 'X',
          livrables: [{ title: 'Rapport' }],
        },
        'creator-1',
      );

      expect(database.instruction.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            livrables: {
              createMany: {
                data: [
                  {
                    title: 'Rapport',
                    description: undefined,
                    createdById: 'creator-1',
                  },
                ],
              },
            },
          }),
        }),
      );
    });

    it('grants the assignees view access on the dossier', async () => {
      database.instruction.create.mockResolvedValue({
        id: 'i-1',
        dossierId: 'd-1',
      });

      await service.create(
        {
          dossierId: 'd-1',
          title: 'X',
          executantIds: ['u-1'],
          superviseurId: 'u-2',
        },
        'creator-1',
      );

      expect(database.dossierAccess.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { dossierId_userId: { dossierId: 'd-1', userId: 'u-1' } },
          update: { canView: true },
        }),
      );
      expect(database.dossierAccess.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { dossierId_userId: { dossierId: 'd-1', userId: 'u-2' } },
          update: { canView: true },
        }),
      );
    });

    it('also grants view access on the courrier, when the instruction has one — independent of the dossier grant', async () => {
      database.instruction.create.mockResolvedValue({
        id: 'i-1',
        dossierId: 'd-1',
        courrierId: 'c-1',
      });

      await service.create(
        {
          dossierId: 'd-1',
          courrierId: 'c-1',
          title: 'X',
          executantIds: ['u-1'],
        },
        'creator-1',
      );

      expect(database.courrierAccess.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { courrierId_userId: { courrierId: 'c-1', userId: 'u-1' } },
          update: { canView: true },
        }),
      );
    });

    it('does not touch courrierAccess when the instruction has no courrier', async () => {
      database.instruction.create.mockResolvedValue({
        id: 'i-1',
        dossierId: 'd-1',
        courrierId: null,
      });

      await service.create(
        { dossierId: 'd-1', title: 'X', executantIds: ['u-1'] },
        'creator-1',
      );

      expect(database.courrierAccess.upsert).not.toHaveBeenCalled();
    });

    it('creates the sub-task dependency when dependsOnId is given', async () => {
      database.instruction.findUnique.mockResolvedValue({ id: 'parent-1' });
      database.instruction.create.mockResolvedValue({
        id: 'i-1',
        dossierId: 'd-1',
      });

      await service.create(
        { dossierId: 'd-1', title: 'X', dependsOnId: 'parent-1' },
        'creator-1',
      );

      expect(database.instruction.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            dependsOn: { create: { dependsOnId: 'parent-1' } },
          }),
        }),
      );
    });

    it('refuses when the parent task does not exist', async () => {
      database.instruction.findUnique.mockResolvedValue(null);

      await expect(
        service.create(
          { dossierId: 'd-1', title: 'X', dependsOnId: 'missing' },
          'creator-1',
        ),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(database.instruction.create).not.toHaveBeenCalled();
    });
  });

  describe('assign', () => {
    it('grants the newly-assigned executant view access on the dossier', async () => {
      database.instruction.findUnique.mockResolvedValue({
        id: 'i-1',
        dossierId: 'd-1',
        status: InstructionStatus.A_AFFECTER,
      });
      database.instruction.update.mockResolvedValue({
        id: 'i-1',
        dossierId: 'd-1',
        status: InstructionStatus.EN_COURS,
      });

      await service.assign('i-1', { executantIds: ['u-3'] });

      expect(database.dossierAccess.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { dossierId_userId: { dossierId: 'd-1', userId: 'u-3' } },
          create: { dossierId: 'd-1', userId: 'u-3', canView: true },
        }),
      );
    });
  });

  describe('declineSubscription', () => {
    // Assigned to Awa and Paul, created by creator-1, waiting to be
    // subscribed to.
    const assigned = (overrides: Record<string, unknown> = {}) => ({
      id: 'i-1',
      title: 'Rédiger le rapport',
      dossierId: 'd-1',
      courrierId: null,
      createdById: 'creator-1',
      status: InstructionStatus.AFFECTEE,
      assignees: [
        { role: 'EXECUTANT', user: { id: 'u-awa', name: 'Awa' } },
        { role: 'EXECUTANT', user: { id: 'u-paul', name: 'Paul' } },
        { role: 'SUPERVISEUR', user: { id: 'u-sup', name: 'Chef' } },
      ],
      ...overrides,
    });
    const motif = { motif: 'Charge de travail déjà pleine' };

    it('takes the executant off the task and keeps the motif', async () => {
      database.instruction.findUnique.mockResolvedValue(assigned());

      await service.declineSubscription('i-1', motif, 'u-awa');

      expect(database.userInstructions.delete).toHaveBeenCalledWith({
        where: {
          userId_instructionId_role: {
            userId: 'u-awa',
            instructionId: 'i-1',
            role: 'EXECUTANT',
          },
        },
      });
      expect(database.instructionSubscription.create).toHaveBeenCalledWith({
        data: {
          instructionId: 'i-1',
          userId: 'u-awa',
          decision: 'NON_SOUSCRITE',
          motif: 'Charge de travail déjà pleine',
        },
      });
      // The task itself is never modified by the executant.
      expect(database.instruction.update).not.toHaveBeenCalled();
    });

    it('stays with the other executants while there are some', async () => {
      database.instruction.findUnique.mockResolvedValue(assigned());

      await service.declineSubscription('i-1', motif, 'u-awa');

      expect(database.instruction.updateMany).not.toHaveBeenCalled();
      expect(notifications.create).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'TASK_NOT_SUBSCRIBED',
          recipientIds: ['creator-1'],
        }),
      );
    });

    it('goes back to its creator once no executant is left', async () => {
      database.instruction.findUnique.mockResolvedValue(
        assigned({
          assignees: [
            { role: 'EXECUTANT', user: { id: 'u-awa', name: 'Awa' } },
          ],
        }),
      );

      await service.declineSubscription('i-1', motif, 'u-awa');

      expect(database.instruction.updateMany).toHaveBeenCalledWith({
        where: { id: 'i-1', status: InstructionStatus.AFFECTEE },
        data: { status: InstructionStatus.NON_SOUSCRITE },
      });
      expect(notifications.create).toHaveBeenCalledWith(
        expect.objectContaining({
          recipientIds: ['creator-1'],
          message: expect.stringContaining('elle vous revient') as unknown,
        }),
      );
    });

    it.each([
      ['the superviseur', 'u-sup'],
      ['someone not on the task', 'u-other'],
    ])('refuses %s', async (_label, userId) => {
      database.instruction.findUnique.mockResolvedValue(assigned());

      await expect(
        service.declineSubscription('i-1', motif, userId),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(database.userInstructions.delete).not.toHaveBeenCalled();
    });

    it('refuses once subscribed: that is an engagement', async () => {
      database.instruction.findUnique.mockResolvedValue(
        assigned({ status: InstructionStatus.EN_COURS }),
      );

      await expect(
        service.declineSubscription('i-1', motif, 'u-awa'),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(database.userInstructions.delete).not.toHaveBeenCalled();
    });
  });

  describe('subscribe', () => {
    const assigned = {
      id: 'i-1',
      title: 'Rédiger le rapport',
      dossierId: 'd-1',
      courrierId: null,
      createdById: 'creator-1',
      status: InstructionStatus.AFFECTEE,
      assignees: [
        { role: 'EXECUTANT', user: { id: 'u-exec', name: 'Awa' } },
        { role: 'SUPERVISEUR', user: { id: 'u-sup', name: 'Paul' } },
      ],
    };

    beforeEach(() =>
      database.instruction.findUnique.mockResolvedValue(assigned),
    );

    it('lets an executant subscribe to it, and tells the creator and the superviseur', async () => {
      await service.subscribe('i-1', 'u-exec');

      expect(database.instructionSubscription.create).toHaveBeenCalledWith({
        data: { instructionId: 'i-1', userId: 'u-exec', decision: 'SOUSCRITE' },
      });
      expect(database.instruction.updateMany).toHaveBeenCalledWith({
        where: { id: 'i-1', status: InstructionStatus.AFFECTEE },
        data: { status: InstructionStatus.EN_COURS },
      });
      expect(notifications.create).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'TASK_SUBSCRIBED',
          recipientIds: ['creator-1', 'u-sup'],
        }),
      );
    });

    it.each([
      ['the superviseur', 'u-sup'],
      ['someone not on the task', 'u-other'],
    ])('refuses %s', async (_label, userId) => {
      await expect(service.subscribe('i-1', userId)).rejects.toBeInstanceOf(
        ForbiddenException,
      );
      expect(database.instruction.updateMany).not.toHaveBeenCalled();
    });

    it('refuses a task that is not waiting for a subscription', async () => {
      database.instruction.findUnique.mockResolvedValue({
        ...assigned,
        status: InstructionStatus.EN_COURS,
      });

      await expect(service.subscribe('i-1', 'u-exec')).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });

    it('subscribes it only once when two executants subscribe together', async () => {
      database.instruction.updateMany.mockResolvedValue({ count: 0 });

      await expect(service.subscribe('i-1', 'u-exec')).rejects.toBeInstanceOf(
        ConflictException,
      );
    });
  });

  describe('deadlines', () => {
    // Created by creator-1, supervised by u-sup, executed by u-exec.
    const task = (overrides: Record<string, unknown> = {}) => ({
      id: 'i-1',
      title: 'Rédiger le rapport',
      description: 'Rapport de conformité',
      dossierId: 'd-1',
      courrierId: null,
      createdById: 'creator-1',
      status: InstructionStatus.EN_COURS,
      dueDate: new Date('2026-11-20'),
      agentDueDate: null,
      cycle: 1,
      assignees: [
        { role: 'EXECUTANT', user: { id: 'u-exec', name: 'Awa' } },
        { role: 'SUPERVISEUR', user: { id: 'u-sup', name: 'Chef' } },
      ],
      ...overrides,
    });

    beforeEach(() => {
      database.instruction.update.mockImplementation(
        ({ data }: { data: Record<string, unknown> }) =>
          Promise.resolve(task(data)),
      );
    });

    it("refuses an executants' deadline after the task's", async () => {
      await expect(
        service.create(
          {
            dossierId: 'd-1',
            title: 'X',
            dueDate: '2026-11-20',
            agentDueDate: '2026-11-25',
          },
          'creator-1',
        ),
      ).rejects.toThrow(/can't be after the task's deadline/);
      expect(database.instruction.create).not.toHaveBeenCalled();
    });

    it("lets the superviseur set the executants' deadline and tells them", async () => {
      database.instruction.findUnique.mockResolvedValue(task());

      await service.setAgentDueDate('i-1', '2026-11-15', 'u-sup');

      expect(database.instruction.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: {
            agentDueDate: new Date('2026-11-15'),
            agentOverdueNotifiedAt: null,
          },
        }),
      );
      expect(notifications.create).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'TASK_AGENT_DUE_DATE_SET',
          recipientIds: ['u-exec'],
        }),
      );
    });

    it.each([
      ['the creator, when there is a superviseur', 'creator-1'],
      ['an executant', 'u-exec'],
    ])("doesn't let %s set it", async (_label, userId) => {
      database.instruction.findUnique.mockResolvedValue(task());

      await expect(
        service.setAgentDueDate('i-1', '2026-11-15', userId),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('lets the creator set it when there is no superviseur', async () => {
      database.instruction.findUnique.mockResolvedValue(
        task({
          assignees: [
            { role: 'EXECUTANT', user: { id: 'u-exec', name: 'Awa' } },
          ],
        }),
      );

      await service.setAgentDueDate('i-1', '2026-11-15', 'creator-1');

      expect(database.instruction.update).toHaveBeenCalled();
    });

    it('opens a new cycle when the request changes once work has started', async () => {
      database.instruction.findUnique.mockResolvedValue(task());

      await service.update('i-1', { description: 'Nouvelle consigne' });

      expect(database.instruction.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ cycle: { increment: 1 } }) as unknown,
        }),
      );
    });

    it('keeps the cycle before anyone works on it', async () => {
      database.instruction.findUnique.mockResolvedValue(
        task({ status: InstructionStatus.AFFECTEE }),
      );

      await service.update('i-1', { description: 'Nouvelle consigne' });

      expect(database.instruction.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ cycle: undefined }) as unknown,
        }),
      );
    });

    it('flags an overdue task when it is read', async () => {
      database.instruction.findUnique.mockResolvedValue(
        task({
          dueDate: new Date('2020-01-10'),
          agentDueDate: new Date('2020-01-05'),
        }),
      );

      const found = await service.findOne('i-1');

      expect(found.overdue).toEqual({ agent: true, task: true });
    });

    it('is not overdue once done', async () => {
      database.instruction.findUnique.mockResolvedValue(
        task({
          status: InstructionStatus.TERMINEE,
          dueDate: new Date('2020-01-10'),
          agentDueDate: new Date('2020-01-05'),
        }),
      );

      const found = await service.findOne('i-1');

      expect(found.overdue).toEqual({ agent: false, task: false });
    });
  });

  describe('close', () => {
    it('refuses to close while livrables are not all validated', async () => {
      database.instruction.findUnique.mockResolvedValue({
        id: 'i-1',
        status: InstructionStatus.EN_COURS,
      });
      database.livrable.count.mockResolvedValue(1);

      await expect(service.close('i-1')).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });

    it('closes once every livrable is validated', async () => {
      database.instruction.findUnique.mockResolvedValue({
        id: 'i-1',
        status: InstructionStatus.EN_COURS,
      });
      database.livrable.count.mockResolvedValue(0);
      database.instruction.update.mockResolvedValue({
        id: 'i-1',
        status: InstructionStatus.TERMINEE,
      });

      const result = await service.close('i-1');
      expect(result.status).toBe(InstructionStatus.TERMINEE);
    });
  });
});
