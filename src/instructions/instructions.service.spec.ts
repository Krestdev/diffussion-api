import { Test, TestingModule } from '@nestjs/testing';
import { PermissionCode } from '../auth/rbac/rbac.constants';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { InstructionsService } from './instructions.service';
import { DatabaseService } from '../database/database.service';
import { NotificationsService } from '../notifications/notifications.service';
import { ActivityService } from '../activity/activity.service';
import { StorageService } from '../storage/storage.service';
import { RbacService } from '../auth/rbac/rbac.service';
import { SettingsService } from '../administration/settings/settings.service';
import {
  InstructionStatus,
  LivrableStatus,
  UserInstructionRole,
} from '../../generated/prisma/client';

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
  let activity: { tryRecord: jest.Mock; record: jest.Mock };
  let storage: { upload: jest.Mock; delete: jest.Mock };
  let rbac: {
    hasPermission: jest.Mock;
    hasPermissionAtSite: jest.Mock;
    hasGlobalPermission: jest.Mock;
  };
  let database: {
    instruction: Record<string, jest.Mock>;
    livrable: Record<string, jest.Mock>;
    document: Record<string, jest.Mock>;
    userInstructions: Record<string, jest.Mock>;
    instructionSubscription: Record<string, jest.Mock>;
    dossierAccess: Record<string, jest.Mock>;
    courrierAccess: Record<string, jest.Mock>;
    courrier: Record<string, jest.Mock>;
    contract: Record<string, jest.Mock>;
    validation: Record<string, jest.Mock>;
    $transaction: jest.Mock;
  };

  beforeEach(async () => {
    database = {
      // The courrier a task comes from has no supervisor unless a test says so.
      courrier: {
        findUnique: jest.fn().mockResolvedValue(null),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      contract: { findUnique: jest.fn(), count: jest.fn() },
      instruction: {
        create: jest.fn(),
        findUnique: jest.fn(),
        findMany: jest.fn(),
        count: jest.fn(),
        update: jest.fn(),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      livrable: {
        create: jest.fn(),
        findUnique: jest.fn(),
        findUniqueOrThrow: jest.fn().mockResolvedValue({ id: 'l-1' }),
        findMany: jest.fn(),
        count: jest.fn().mockResolvedValue(0),
        update: jest.fn(),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      validation: { createMany: jest.fn(), create: jest.fn() },
      document: { create: jest.fn() },
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
    activity = {
      tryRecord: jest.fn().mockResolvedValue('log-1'),
      record: jest.fn().mockResolvedValue('log-1'),
    };
    storage = {
      upload: jest
        .fn()
        .mockResolvedValue({ key: 'storage-key-1', bucket: 'test-bucket' }),
      delete: jest.fn().mockResolvedValue(undefined),
    };
    rbac = {
      hasPermission: jest.fn().mockResolvedValue(true),
      hasPermissionAtSite: jest.fn().mockResolvedValue(true),
      hasGlobalPermission: jest.fn().mockResolvedValue(false),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        InstructionsService,
        { provide: DatabaseService, useValue: database },
        { provide: NotificationsService, useValue: notifications },
        { provide: ActivityService, useValue: activity },
        { provide: StorageService, useValue: storage },
        { provide: RbacService, useValue: rbac },
        {
          provide: SettingsService,
          useValue: {
            get: jest
              .fn()
              .mockResolvedValue({ maxActiveInstructionsPerAgent: null }),
          },
        },
      ],
    }).compile();

    service = module.get<InstructionsService>(InstructionsService);
  });

  it('is defined', () => {
    expect(service).toBeDefined();
  });

  describe('create', () => {
    it('refuses an archived contract', async () => {
      database.contract.findUnique.mockResolvedValue({
        number: 'CT-1',
        status: 'ARCHIVED',
      });

      await expect(
        service.create({ contractId: 'ct-1', title: 'X' }, 'u-creator'),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(database.instruction.create).not.toHaveBeenCalled();
    });

    it('refuses a contract its creator may not open', async () => {
      database.contract.findUnique.mockResolvedValue({
        number: 'CT-1',
        status: 'ACTIVE',
      });
      database.contract.count.mockResolvedValue(0);

      await expect(
        service.create({ contractId: 'ct-1', title: 'X' }, 'u-creator'),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('waits for its executants to subscribe to it (AFFECTEE)', async () => {
      database.instruction.create.mockResolvedValue({
        id: 'i-1',
        dossierId: 'd-1',
      });

      await service.create(
        {
          validateurId: 'u-val',
          dossierId: 'd-1',
          title: 'X',
          executantIds: ['u-1'],
        },
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
        {
          validateurId: 'u-val',
          dossierId: 'd-1',
          title: 'X',
          superviseurId: 'u-sup',
        },
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

    it('starts A_AFFECTER with no executant yet, its validateur on it', async () => {
      database.instruction.create.mockResolvedValue({
        id: 'i-1',
        dossierId: 'd-1',
      });

      await service.create(
        { validateurId: 'u-val', dossierId: 'd-1', title: 'X' },
        'creator-1',
      );

      expect(database.instruction.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status: InstructionStatus.A_AFFECTER,
            assignees: {
              createMany: {
                data: [{ userId: 'u-val', role: 'VALIDATEUR' }],
              },
            },
          }),
        }),
      );
    });

    it('creates initial livrables along with the instruction', async () => {
      database.instruction.create.mockResolvedValue({
        id: 'i-1',
        dossierId: 'd-1',
      });

      await service.create(
        {
          validateurId: 'u-val',
          dossierId: 'd-1',
          title: 'X',
          livrables: [{ title: 'Rapport' }, { title: 'Annexe' }],
        },
        'creator-1',
      );

      // Numbered in the order they were entered.
      expect(database.instruction.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            livrables: {
              createMany: {
                data: [
                  {
                    position: 0,
                    title: 'Rapport',
                    description: undefined,
                    createdById: 'creator-1',
                  },
                  {
                    position: 1,
                    title: 'Annexe',
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
          validateurId: 'u-val',
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
          validateurId: 'u-val',
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
        {
          validateurId: 'u-val',
          dossierId: 'd-1',
          title: 'X',
          executantIds: ['u-1'],
        },
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
        {
          validateurId: 'u-val',
          dossierId: 'd-1',
          title: 'X',
          dependsOnId: 'parent-1',
        },
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
          {
            validateurId: 'u-val',
            dossierId: 'd-1',
            title: 'X',
            dependsOnId: 'missing',
          },
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
      // Its superviseur is told.
      expect(notifications.create).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'TASK_NOT_SUBSCRIBED',
          recipientIds: ['u-sup'],
        }),
      );
    });

    it('goes back to its superviseur once no executant is left', async () => {
      database.instruction.findUnique.mockResolvedValue(
        assigned({
          assignees: [
            { role: 'EXECUTANT', user: { id: 'u-awa', name: 'Awa' } },
            { role: 'SUPERVISEUR', user: { id: 'u-sup', name: 'Chef' } },
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
          recipientIds: ['u-sup'],
          message: expect.stringContaining('elle vous revient') as unknown,
        }),
      );
    });

    it('goes back to its creator when it has no superviseur', async () => {
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

    it('puts its effet "En traitement" on the first subscription', async () => {
      database.instruction.findUnique.mockResolvedValue({
        ...assigned,
        courrierId: 'c-1',
      });

      await service.subscribe('i-1', 'u-exec');

      expect(database.courrier.updateMany).toHaveBeenCalledWith({
        where: { id: 'c-1', status: 'TRANSMIS' },
        data: { status: 'EN_TRAITEMENT' },
      });
    });

    it('leaves the effets alone for a task without one', async () => {
      await service.subscribe('i-1', 'u-exec');

      expect(database.courrier.updateMany).not.toHaveBeenCalled();
    });

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

    it('the validateur cannot set the deadline', async () => {
      database.instruction.findUnique.mockResolvedValue(
        task({
          assignees: [
            { role: 'EXECUTANT', user: { id: 'u-exec', name: 'Awa' } },
            { role: 'SUPERVISEUR', user: { id: 'u-sup', name: 'Chef' } },
            { role: 'VALIDATEUR', user: { id: 'u-val', name: 'Val' } },
          ],
        }),
      );

      await expect(
        service.setAgentDueDate('i-1', '2026-11-10', 'u-val'),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it("refuses an executants' deadline after the task's", async () => {
      await expect(
        service.create(
          {
            validateurId: 'u-val',
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

  describe('who hands the livrables in', () => {
    beforeEach(() =>
      database.instruction.findUnique.mockResolvedValue({
        dossier: { siteId: 's-1' },
      }),
    );

    it('lets the subscriber prepare livrables without the permissions', async () => {
      database.instruction.count.mockResolvedValue(1); // subscribed
      rbac.hasPermissionAtSite.mockResolvedValue(false);

      await expect(
        service.assertMayWorkOn('i-1', 'u-exec', [
          PermissionCode.LivrableDeposit,
        ]),
      ).resolves.toBeUndefined();
      expect(database.instruction.count).toHaveBeenCalledWith({
        where: {
          id: 'i-1',
          assignees: { some: { userId: 'u-exec', role: 'EXECUTANT' } },
          subscriptions: {
            some: { userId: 'u-exec', decision: 'SOUSCRITE' },
          },
        },
      });
    });

    it('someone else needs every permission at the task site', async () => {
      database.instruction.count.mockResolvedValue(0);
      rbac.hasPermissionAtSite.mockImplementation((_u: string, perm: string) =>
        Promise.resolve(perm !== 'LIVRABLE_SUBMIT'),
      );

      await expect(
        service.assertMayWorkOn('i-1', 'u-other', [
          PermissionCode.LivrableDeposit,
          PermissionCode.LivrableSubmit,
        ]),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('only the subscriber deposits — not a co-executant, nor a permission holder', async () => {
      database.instruction.count.mockResolvedValue(0);
      rbac.hasPermissionAtSite.mockResolvedValue(true);

      await expect(
        service.assertSubscriber('i-1', 'u-co-executant'),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });
  });

  describe('my tasks', () => {
    beforeEach(() => {
      database.instruction.findMany.mockResolvedValue([]);
      database.instruction.count.mockResolvedValue(0);
    });
    const listed = () =>
      (
        database.instruction.findMany.mock.calls[0][0] as {
          where: { AND: Record<string, unknown>[] };
        }
      ).where.AND[0];

    it('"en cours": a co-executant who did not subscribe no longer sees it', async () => {
      await service.findMyTasks({ tab: 'en-cours' }, 'u-1');

      expect(listed()).toMatchObject({
        OR: [
          {
            assignees: {
              some: { userId: 'u-1', role: { not: 'EXECUTANT' } },
            },
          },
          {
            assignees: { some: { userId: 'u-1', role: 'EXECUTANT' } },
            subscriptions: {
              some: { userId: 'u-1', decision: 'SOUSCRITE' },
            },
          },
        ],
      });
    });

    it('"à souscrire" still lists every executant', async () => {
      await service.findMyTasks({ tab: 'a-souscrire' }, 'u-1');

      expect(listed()).toMatchObject({
        assignees: { some: { userId: 'u-1' } },
      });
    });
  });

  describe('validation chain', () => {
    // Validated by u-val, then by its superviseur u-sup.
    const awaiting = (step: number, withValidateur = true) => ({
      id: 'i-1',
      title: 'Rédiger le rapport',
      dossierId: 'd-1',
      courrierId: null,
      createdById: 'creator-1',
      status: InstructionStatus.EN_ATTENTE_VALIDATION,
      cycle: 1,
      assignees: [
        { role: 'EXECUTANT', user: { id: 'u-exec', name: 'Awa' } },
        { role: 'SUPERVISEUR', user: { id: 'u-sup', name: 'Chef' } },
        ...(withValidateur
          ? [{ role: 'VALIDATEUR', user: { id: 'u-val', name: 'V' } }]
          : []),
      ],
      livrables: [
        {
          id: 'l-1',
          title: 'Rapport',
          status: LivrableStatus.SOUMIS,
          validationStep: step,
        },
      ],
    });
    const submitted = (step: number) => [
      { id: 'l-1', title: 'Rapport', validationStep: step },
    ];

    it('the validateur gives an opinion, which hands the livrable to the superviseur', async () => {
      database.instruction.findUnique.mockResolvedValue(awaiting(0));
      database.livrable.findUnique.mockResolvedValue({
        instructionId: 'i-1',
        title: 'Rapport',
        status: LivrableStatus.SOUMIS,
        validationStep: 0,
      });

      await service.giveAvis('l-1', 'Conforme, sauf la section 3', 'u-val');

      expect(database.livrable.updateMany).toHaveBeenCalledWith({
        where: { id: 'l-1', status: LivrableStatus.SOUMIS, validationStep: 0 },
        data: { validationStep: 1 },
      });
      expect(database.validation.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          livrableId: 'l-1',
          validatorId: 'u-val',
          decision: 'AVIS',
          comment: 'Conforme, sauf la section 3',
        }),
      });
      expect(notifications.create).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'TASK_VALIDATION_PENDING',
          recipientIds: ['u-sup'],
        }),
      );
      expect(activity.tryRecord).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'INSTRUCTION_AVIS_DONNE' }),
      );
    });

    it('only the validateur gives an opinion, once', async () => {
      database.instruction.findUnique.mockResolvedValue(awaiting(0));
      database.livrable.findUnique.mockResolvedValue({
        instructionId: 'i-1',
        title: 'Rapport',
        status: LivrableStatus.SOUMIS,
        validationStep: 0,
      });
      await expect(
        service.giveAvis('l-1', 'Avis', 'u-sup'),
      ).rejects.toBeInstanceOf(ForbiddenException);

      database.livrable.findUnique.mockResolvedValue({
        instructionId: 'i-1',
        title: 'Rapport',
        status: LivrableStatus.SOUMIS,
        validationStep: 1,
      });
      await expect(
        service.giveAvis('l-1', 'Avis', 'u-val'),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('the validateur never decides', async () => {
      database.instruction.findUnique.mockResolvedValue(awaiting(0));
      database.livrable.findMany.mockResolvedValue(submitted(0));

      await expect(
        service.approveLivrables('i-1', 'u-val'),
      ).rejects.toBeInstanceOf(ForbiddenException);
      await expect(
        service.approveSelectedLivrables('i-1', ['l-1'], 'u-val'),
      ).rejects.toBeInstanceOf(ForbiddenException);
      await expect(
        service.requestCorrections(
          'i-1',
          { livrables: [{ livrableId: 'l-1', motif: 'Incomplet' }] },
          'u-val',
        ),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('the superviseur cannot decide before the validateur', async () => {
      database.instruction.findUnique.mockResolvedValue(awaiting(0));
      database.livrable.findMany.mockResolvedValue(submitted(0));

      await expect(
        service.approveLivrables('i-1', 'u-sup'),
      ).rejects.toBeInstanceOf(BadRequestException);
      await expect(
        service.approveSelectedLivrables('i-1', ['l-1'], 'u-sup'),
      ).rejects.toBeInstanceOf(ForbiddenException);
      await expect(
        service.requestCorrections(
          'i-1',
          { livrables: [{ livrableId: 'l-1', motif: 'Incomplet' }] },
          'u-sup',
        ),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(database.livrable.updateMany).not.toHaveBeenCalled();
    });

    it('the superviseur, last link, validates the livrable', async () => {
      database.instruction.findUnique.mockResolvedValue(awaiting(1));

      await service.approveLivrables('i-1', 'u-sup');

      expect(database.livrable.updateMany).toHaveBeenCalledWith({
        where: { id: { in: ['l-1'] }, status: LivrableStatus.SOUMIS },
        data: { status: LivrableStatus.VALIDE },
      });
    });

    it('journals each livrable validated, or sent back with its motif', async () => {
      database.instruction.findUnique.mockResolvedValue(awaiting(1));
      await service.approveLivrables('i-1', 'u-sup');
      expect(activity.tryRecord).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'INSTRUCTION_LIVRABLE_VALIDE',
          entityId: 'i-1',
          metadata: { livrableId: 'l-1', title: 'Rapport' },
        }),
      );

      database.livrable.findMany.mockResolvedValue(submitted(1));
      database.instruction.update.mockResolvedValue(awaiting(1));
      await service.requestCorrections(
        'i-1',
        { livrables: [{ livrableId: 'l-1', motif: 'Incomplet' }] },
        'u-sup',
      );
      expect(activity.tryRecord).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'INSTRUCTION_CORRECTION_DEMANDEE',
          metadata: { livrableId: 'l-1', title: 'Rapport', motif: 'Incomplet' },
        }),
      );
    });

    it('without a validateur, the superviseur decides from the start', async () => {
      database.instruction.findUnique.mockResolvedValue(awaiting(0, false));

      await service.approveLivrables('i-1', 'u-sup');

      expect(database.livrable.updateMany).toHaveBeenCalledWith({
        where: { id: { in: ['l-1'] }, status: LivrableStatus.SOUMIS },
        data: { status: LivrableStatus.VALIDE },
      });
    });

    it('creates a task without a validateur', async () => {
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
            assignees: {
              createMany: {
                data: [{ userId: 'u-sup', role: 'SUPERVISEUR' }],
              },
            },
          }),
        }),
      );
    });

    it('the validateur cannot be one of the executants', async () => {
      await expect(
        service.create(
          {
            validateurId: 'u-exec',
            dossierId: 'd-1',
            title: 'X',
            executantIds: ['u-exec'],
          },
          'creator-1',
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
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

  describe('deposerLivrables', () => {
    const fakeFile = (
      fieldname: string,
      originalname = 'test.pdf',
    ): Express.Multer.File => ({
      fieldname,
      originalname,
      mimetype: 'application/pdf',
      size: 1024,
      buffer: Buffer.from('dummy content'),
      encoding: '7bit',
      destination: '',
      filename: originalname,
      path: '',
      stream: null as any,
    });

    // The caller is the executant who subscribed, unless a test says
    // otherwise.
    beforeEach(() => database.instruction.count.mockResolvedValue(1));

    it('refuses a co-executant who did not subscribe', async () => {
      database.instruction.findUnique.mockResolvedValue(baseInstruction);
      database.instruction.count.mockResolvedValue(0);

      await expect(
        service.deposerLivrables(
          'inst-1',
          {
            livrables: JSON.stringify([{ livrableId: 'liv-1', files: ['f0'] }]),
          },
          [fakeFile('f0')],
          'exec-2',
        ),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    const baseInstruction = {
      id: 'inst-1',
      title: 'Tâche Test',
      status: InstructionStatus.EN_COURS,
      dossierId: 'dos-1',
      dossier: { id: 'dos-1', siteId: 'site-1' },
      assignees: [
        {
          role: UserInstructionRole.EXECUTANT,
          user: { id: 'exec-1', name: 'Alice Exec' },
        },
        {
          role: UserInstructionRole.SUPERVISEUR,
          user: { id: 'sup-1', name: 'Bob Superviseur' },
        },
      ],
      createdById: 'creator-1',
    };

    it('deposits and submits multiple deliverables in one atomic call', async () => {
      database.instruction.findUnique
        .mockResolvedValueOnce(baseInstruction)
        .mockResolvedValueOnce({
          ...baseInstruction,
          status: InstructionStatus.EN_ATTENTE_VALIDATION,
        });

      database.livrable.findUnique
        .mockResolvedValueOnce({
          id: 'liv-1',
          instructionId: 'inst-1',
          isLatest: true,
          status: LivrableStatus.EN_PREPARATION,
        })
        .mockResolvedValueOnce({
          id: 'liv-2',
          instructionId: 'inst-1',
          title: 'Annexe',
          description: null,
          version: 1,
          position: 1,
          isLatest: true,
          status: LivrableStatus.REJETE,
        });
      // liv-2 was sent back for corrections: redeposited as a new version.
      database.livrable.create.mockResolvedValueOnce({ id: 'liv-2-v2' });

      storage.upload
        .mockResolvedValueOnce({ key: 'key-f0' })
        .mockResolvedValueOnce({ key: 'key-f1' })
        .mockResolvedValueOnce({ key: 'key-f2' });

      const files = [
        fakeFile('f0', 'doc1.pdf'),
        fakeFile('f1', 'doc2.pdf'),
        fakeFile('f2', 'doc3.pdf'),
      ];
      const dto = {
        livrables: JSON.stringify([
          { livrableId: 'liv-1', files: ['f0'] },
          { livrableId: 'liv-2', files: ['f1', 'f2'] },
        ]),
        agentComment: 'Voici les livrables finaux',
      };

      const result = await service.deposerLivrables(
        'inst-1',
        dto,
        files,
        'exec-1',
      );

      expect(storage.upload).toHaveBeenCalledTimes(3);
      expect(storage.upload).toHaveBeenCalledWith(
        files[0].buffer,
        expect.objectContaining({
          originalName: 'doc1.pdf',
          prefix: 'livrables/liv-1',
        }),
      );
      expect(storage.upload).toHaveBeenCalledWith(
        files[1].buffer,
        expect.objectContaining({
          originalName: 'doc2.pdf',
          prefix: 'livrables/liv-2',
        }),
      );

      expect(database.document.create).toHaveBeenCalledTimes(3);
      expect(database.document.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            originalName: 'doc1.pdf',
            storageKey: 'key-f0',
            livrableId: 'liv-1',
            uploadedById: 'exec-1',
          }),
        }),
      );

      expect(database.livrable.update).toHaveBeenCalledTimes(2);
      expect(database.livrable.update).toHaveBeenCalledWith({
        where: { id: 'liv-1' },
        data: {
          status: LivrableStatus.SOUMIS,
          validationStep: 0,
          agentComment: 'Voici les livrables finaux',
        },
      });
      expect(database.livrable.updateMany).toHaveBeenCalledWith({
        where: { id: 'liv-2', isLatest: true },
        data: { isLatest: false },
      });
      expect(database.livrable.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          version: 2,
          position: 1,
          parentVersionId: 'liv-2',
          title: 'Annexe',
        }),
        select: { id: true },
      });
      // Its new files go to the new version, which is the one submitted.
      expect(database.document.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            storageKey: 'key-f1',
            livrableId: 'liv-2-v2',
          }),
        }),
      );
      expect(database.livrable.update).toHaveBeenCalledWith({
        where: { id: 'liv-2-v2' },
        data: {
          status: LivrableStatus.SOUMIS,
          validationStep: 0,
          agentComment: 'Voici les livrables finaux',
        },
      });

      expect(database.instruction.update).toHaveBeenCalledWith({
        where: { id: 'inst-1' },
        data: { status: InstructionStatus.EN_ATTENTE_VALIDATION },
      });

      expect(notifications.create).toHaveBeenCalledTimes(1);
      expect(notifications.create).toHaveBeenCalledWith(
        expect.objectContaining({
          recipientIds: ['sup-1'],
          type: 'TASK_LIVRABLES_DEPOSITED',
          message: expect.stringContaining('Alice Exec a déposé 2 livrables'),
        }),
      );

      expect(activity.tryRecord).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'INSTRUCTION_LIVRABLES_DEPOSES',
          entityType: 'Instruction',
          entityId: 'inst-1',
          message: 'Alice Exec a déposé 2 livrables',
        }),
      );

      expect(result.status).toBe(InstructionStatus.EN_ATTENTE_VALIDATION);
    });

    it('refuses when the user is not an executant of the instruction', async () => {
      database.instruction.findUnique.mockResolvedValue(baseInstruction);
      database.instruction.count.mockResolvedValue(0);

      const dto = {
        livrables: JSON.stringify([{ livrableId: 'liv-1', files: ['f0'] }]),
      };

      await expect(
        service.deposerLivrables('inst-1', dto, [fakeFile('f0')], 'other-user'),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('refuses when instruction is not in an allowed status', async () => {
      database.instruction.findUnique.mockResolvedValue({
        ...baseInstruction,
        status: InstructionStatus.AFFECTEE,
      });

      const dto = {
        livrables: JSON.stringify([{ livrableId: 'liv-1', files: ['f0'] }]),
      };

      await expect(
        service.deposerLivrables('inst-1', dto, [fakeFile('f0')], 'exec-1'),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('refuses when a livrable does not belong to the instruction', async () => {
      database.instruction.findUnique.mockResolvedValue(baseInstruction);
      database.livrable.findUnique.mockResolvedValue({
        id: 'liv-1',
        instructionId: 'other-inst',
        isLatest: true,
        status: LivrableStatus.EN_PREPARATION,
      });

      const dto = {
        livrables: JSON.stringify([{ livrableId: 'liv-1', files: ['f0'] }]),
      };

      await expect(
        service.deposerLivrables('inst-1', dto, [fakeFile('f0')], 'exec-1'),
      ).rejects.toThrow("n'appartient pas à cette instruction");
    });

    it('refuses when a livrable is not the latest version', async () => {
      database.instruction.findUnique.mockResolvedValue(baseInstruction);
      database.livrable.findUnique.mockResolvedValue({
        id: 'liv-1',
        instructionId: 'inst-1',
        isLatest: false,
        status: LivrableStatus.EN_PREPARATION,
      });

      const dto = {
        livrables: JSON.stringify([{ livrableId: 'liv-1', files: ['f0'] }]),
      };

      await expect(
        service.deposerLivrables('inst-1', dto, [fakeFile('f0')], 'exec-1'),
      ).rejects.toThrow("n'est pas la dernière version");
    });

    it('refuses when a livrable is already submitted or validated', async () => {
      database.instruction.findUnique.mockResolvedValue(baseInstruction);
      database.livrable.findUnique.mockResolvedValue({
        id: 'liv-1',
        instructionId: 'inst-1',
        isLatest: true,
        status: LivrableStatus.VALIDE,
      });

      const dto = {
        livrables: JSON.stringify([{ livrableId: 'liv-1', files: ['f0'] }]),
      };

      await expect(
        service.deposerLivrables('inst-1', dto, [fakeFile('f0')], 'exec-1'),
      ).rejects.toThrow('statut VALIDE incompatible');
    });

    it('refuses and cleans up storage when an error occurs during file upload', async () => {
      database.instruction.findUnique.mockResolvedValue(baseInstruction);
      database.livrable.findUnique.mockResolvedValue({
        id: 'liv-1',
        instructionId: 'inst-1',
        isLatest: true,
        status: LivrableStatus.EN_PREPARATION,
      });

      storage.upload.mockRejectedValueOnce(new Error('S3 network error'));

      const dto = {
        livrables: JSON.stringify([{ livrableId: 'liv-1', files: ['f0'] }]),
      };

      await expect(
        service.deposerLivrables('inst-1', dto, [fakeFile('f0')], 'exec-1'),
      ).rejects.toBeInstanceOf(BadRequestException);

      expect(storage.delete).toHaveBeenCalledTimes(0);
    });

    it('cleans up previously uploaded storage files if subsequent livrable fails', async () => {
      database.instruction.findUnique.mockResolvedValue(baseInstruction);
      database.livrable.findUnique
        .mockResolvedValueOnce({
          id: 'liv-1',
          instructionId: 'inst-1',
          isLatest: true,
          status: LivrableStatus.EN_PREPARATION,
        })
        .mockResolvedValueOnce({
          id: 'liv-2',
          instructionId: 'inst-1',
          isLatest: true,
          status: LivrableStatus.EN_PREPARATION,
        });

      storage.upload
        .mockResolvedValueOnce({ key: 'key-f0' })
        .mockRejectedValueOnce(new Error('Storage failure'));

      const files = [fakeFile('f0'), fakeFile('f1')];
      const dto = {
        livrables: JSON.stringify([
          { livrableId: 'liv-1', files: ['f0'] },
          { livrableId: 'liv-2', files: ['f1'] },
        ]),
      };

      await expect(
        service.deposerLivrables('inst-1', dto, files, 'exec-1'),
      ).rejects.toThrow('Livrable liv-2');

      expect(storage.delete).toHaveBeenCalledWith('key-f0');
    });
  });
});
