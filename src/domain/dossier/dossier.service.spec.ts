import { Test, TestingModule } from '@nestjs/testing';
import { ClsServiceManager } from 'nestjs-cls';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { DossierService } from './dossier.service';
import { DatabaseService } from '../../database/database.service';
import { NotificationsService } from '../../notifications/notifications.service';
import { AccessService } from '../../auth/access/access.service';
import { ActivityService } from '../../activity/activity.service';
import { DossierStatus } from '../../../generated/prisma/client';
import { WorkflowService } from '../../workflow/workflow.service';

// Runs as a signed-in person holding `permissions` (the engine checks them).
const asPerson = <T>(permissions: string[], fn: () => Promise<T>) => {
  const cls = ClsServiceManager.getClsService();
  return cls.run(() => {
    cls.set('permissions', permissions);
    return fn();
  });
};

describe('DossierService', () => {
  let service: DossierService;
  let database: {
    dossier: Record<string, jest.Mock>;
    instruction: Record<string, jest.Mock>;
    courrier: Record<string, jest.Mock>;
    livrable: Record<string, jest.Mock>;
    contract: Record<string, jest.Mock>;
    project: Record<string, jest.Mock>;
    activityLog: Record<string, jest.Mock>;
    statusHistory: { create: jest.Mock };
    $transaction: jest.Mock;
  };
  let access: { has: jest.Mock };

  beforeEach(async () => {
    access = { has: jest.fn().mockResolvedValue(false) };
    database = {
      dossier: {
        create: jest.fn(),
        findUnique: jest.fn(),
        findMany: jest.fn(),
        count: jest.fn(),
        update: jest.fn(),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        findUniqueOrThrow: jest.fn(),
      },
      instruction: { count: jest.fn(), findMany: jest.fn() },
      courrier: { findMany: jest.fn(), count: jest.fn().mockResolvedValue(0) },
      livrable: { findMany: jest.fn() },
      contract: { findUnique: jest.fn() },
      project: {
        findUnique: jest
          .fn()
          .mockResolvedValue({ name: 'P', companyId: 's-1' }),
      },
      activityLog: { findMany: jest.fn() },
      statusHistory: { create: jest.fn() },
      $transaction: jest.fn((arg: unknown) =>
        typeof arg === 'function'
          ? (arg as (tx: unknown) => unknown)(database)
          : Promise.all(arg as unknown[]),
      ),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DossierService,
        WorkflowService,
        { provide: DatabaseService, useValue: database },
        { provide: AccessService, useValue: access },
        {
          provide: NotificationsService,
          useValue: { notifyAccessChanged: jest.fn() },
        },
        {
          provide: ActivityService,
          useValue: {
            record: jest.fn().mockResolvedValue('log-1'),
            tryRecord: jest.fn().mockResolvedValue('log-1'),
          },
        },
      ],
    }).compile();

    service = module.get<DossierService>(DossierService);
  });

  it('is defined', () => {
    expect(service).toBeDefined();
  });

  describe('findOne', () => {
    it('throws NotFoundException when the dossier does not exist', async () => {
      database.dossier.findUnique.mockResolvedValue(null);
      await expect(service.findOne('missing')).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });

  describe('close', () => {
    it('refuses to close a dossier that still has open instructions (RG-DOS-005)', async () => {
      database.dossier.findUnique.mockResolvedValue({
        id: 'd-1',
        status: DossierStatus.IN_PROGRESS,
      });
      database.instruction.count.mockResolvedValue(2);

      await expect(service.close('d-1')).rejects.toBeInstanceOf(
        BadRequestException,
      );
      expect(database.dossier.update).not.toHaveBeenCalled();
    });

    it('closes a dossier once every instruction is terminal', async () => {
      database.dossier.findUnique.mockResolvedValue({
        id: 'd-1',
        status: DossierStatus.IN_PROGRESS,
      });
      database.instruction.count.mockResolvedValue(0);
      database.dossier.findUniqueOrThrow.mockResolvedValue({
        id: 'd-1',
        status: DossierStatus.CLOSED,
      });

      const result = await asPerson(['dossier.close'], () =>
        service.close('d-1'),
      );

      // Through the workflow engine: conditional on the status read, and recorded.
      expect(database.dossier.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'd-1', status: DossierStatus.IN_PROGRESS },
          data: expect.objectContaining({ status: DossierStatus.CLOSED }),
        }),
      );
      expect(database.statusHistory.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          entity: 'Dossier',
          fromStatus: DossierStatus.IN_PROGRESS,
          toStatus: DossierStatus.CLOSED,
          event: 'CLOSE',
        }),
      });
      expect(result.status).toBe(DossierStatus.CLOSED);
    });

    it('refuses to close while a courrier awaits validation', async () => {
      database.dossier.findUnique.mockResolvedValue({
        id: 'd-1',
        status: DossierStatus.IN_PROGRESS,
      });
      database.instruction.count.mockResolvedValue(0);
      database.courrier.count.mockResolvedValue(1);

      await expect(service.close('d-1')).rejects.toBeInstanceOf(
        BadRequestException,
      );
      expect(database.dossier.update).not.toHaveBeenCalled();
    });
  });

  describe('update', () => {
    it('refuses to mutate a closed dossier (RG-DOS-007)', async () => {
      database.dossier.findUnique.mockResolvedValue({
        id: 'd-1',
        status: DossierStatus.CLOSED,
      });

      await expect(
        service.update('d-1', { title: 'New title' }, 'u-1'),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('refuses to clear the responsible (RG-DOS-004)', async () => {
      database.dossier.findUnique.mockResolvedValue({
        id: 'd-1',
        status: DossierStatus.IN_PROGRESS,
        companyId: 's-1',
        responsibleId: 'u-1',
      });

      await expect(
        service.update(
          'd-1',
          { responsibleId: null as unknown as string },
          'u-1',
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('refuses to move a dossier to another company without company.update', async () => {
      database.dossier.findUnique.mockResolvedValue({
        id: 'd-1',
        status: DossierStatus.IN_PROGRESS,
        companyId: 's-1',
        responsibleId: 'u-1',
      });

      await expect(
        service.update('d-1', { companyId: 's-2' }, 'u-1'),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(database.dossier.update).not.toHaveBeenCalled();
    });
  });

  describe('contract', () => {
    const openDossier = {
      id: 'd-1',
      status: DossierStatus.IN_PROGRESS,
      companyId: 's-1',
      responsibleId: 'u-1',
      projectId: null,
      contractId: null,
    };
    const updatedData = () =>
      (
        database.dossier.update.mock.calls[0][0] as {
          data: { projectId?: string | null; contractId?: string };
        }
      ).data;

    it('takes the project from the contract', async () => {
      database.dossier.findUnique.mockResolvedValue(openDossier);
      database.contract.findUnique.mockResolvedValue({
        number: 'CT-1',
        projectId: 'p-1',
      });
      database.dossier.update.mockResolvedValue({ id: 'd-1' });

      await service.update('d-1', { contractId: 'c-1' }, 'u-1');

      expect(updatedData()).toMatchObject({
        contractId: 'c-1',
        projectId: 'p-1',
      });
    });

    it("refuses a project other than the contract's", async () => {
      database.dossier.findUnique.mockResolvedValue(openDossier);
      database.contract.findUnique.mockResolvedValue({
        number: 'CT-1',
        projectId: 'p-1',
      });

      await expect(
        service.update('d-1', { contractId: 'c-1', projectId: 'p-2' }, 'u-1'),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(database.dossier.update).not.toHaveBeenCalled();
    });

    it('refuses to change the project of a dossier under a contract', async () => {
      database.dossier.findUnique.mockResolvedValue({
        ...openDossier,
        projectId: 'p-1',
        contractId: 'c-1',
      });
      database.contract.findUnique.mockResolvedValue({
        number: 'CT-1',
        projectId: 'p-1',
      });

      await expect(
        service.update('d-1', { projectId: 'p-2' }, 'u-1'),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    describe('in a project made of contracts', () => {
      beforeEach(() => {
        database.project.findUnique.mockResolvedValue({
          name: 'P',
          companyId: 's-1',
          contentType: 'CONTRATS',
        });
      });

      it('refuses a dossier outside any contract', async () => {
        database.dossier.findUnique.mockResolvedValue(openDossier);

        await expect(
          service.update('d-1', { projectId: 'p-1' }, 'u-1'),
        ).rejects.toThrow('ne contient que des contrats');
        expect(database.dossier.update).not.toHaveBeenCalled();
      });

      it('refuses to take a dossier out of its contract', async () => {
        database.dossier.findUnique.mockResolvedValue({
          ...openDossier,
          projectId: 'p-1',
          contractId: 'c-1',
        });

        await expect(
          service.update(
            'd-1',
            { contractId: null as unknown as string },
            'u-1',
          ),
        ).rejects.toThrow('ne contient que des contrats');
      });

      it('accepts a dossier under one of its contracts', async () => {
        database.dossier.findUnique.mockResolvedValue(openDossier);
        database.contract.findUnique.mockResolvedValue({
          number: 'CT-1',
          projectId: 'p-1',
        });
        database.dossier.update.mockResolvedValue({ id: 'd-1' });

        await service.update('d-1', { contractId: 'c-1' }, 'u-1');

        expect(updatedData().projectId).toBe('p-1');
      });
    });

    it('refuses an unknown contract', async () => {
      database.dossier.findUnique.mockResolvedValue(openDossier);
      database.contract.findUnique.mockResolvedValue(null);

      await expect(
        service.update('d-1', { contractId: 'c-x' }, 'u-1'),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('keeps the chosen project when the contract has none', async () => {
      database.dossier.findUnique.mockResolvedValue(openDossier);
      database.contract.findUnique.mockResolvedValue({
        number: 'CT-1',
        projectId: null,
      });
      database.dossier.update.mockResolvedValue({ id: 'd-1' });

      await service.update(
        'd-1',
        { contractId: 'c-1', projectId: 'p-2' },
        'u-1',
      );

      expect(updatedData().projectId).toBe('p-2');
    });
  });

  describe('reopen', () => {
    it('refuses to reopen a dossier that is not closed (RG-DOS-008)', async () => {
      database.dossier.findUnique.mockResolvedValue({
        id: 'd-1',
        status: DossierStatus.OPEN,
      });

      // 409 INVALID_TRANSITION (workflow engine), no longer 400.
      await expect(service.reopen('d-1')).rejects.toBeInstanceOf(
        ConflictException,
      );
      expect(database.dossier.updateMany).not.toHaveBeenCalled();
    });

    it('reopens a closed dossier, LATE when already overdue', async () => {
      database.dossier.findUnique.mockResolvedValue({
        id: 'd-1',
        status: DossierStatus.CLOSED,
        companyId: 's-1',
        dueDate: new Date('2020-01-01'),
      });
      database.dossier.findUniqueOrThrow.mockResolvedValue({ id: 'd-1' });
      await asPerson(['dossier.reopen'], () => service.reopen('d-1'));
      expect(database.dossier.updateMany).toHaveBeenCalledWith({
        where: { id: 'd-1', status: DossierStatus.CLOSED },
        data: {
          closedAt: null,
          archivedAt: null,
          status: DossierStatus.LATE,
        },
      });
    });
  });

  describe('due date', () => {
    it('turns LATE when the due date moves into the past (DUE_DATE_CHANGED)', async () => {
      database.dossier.findUnique.mockResolvedValue({
        id: 'd-1',
        status: DossierStatus.IN_PROGRESS,
        companyId: 's-1',
        responsibleId: 'u-1',
      });
      await asPerson(['dossier.update'], () =>
        service.update('d-1', { dueDate: '2020-01-01' }, 'u-1'),
      );
      expect(database.statusHistory.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          event: 'DUE_DATE_CHANGED',
          toStatus: DossierStatus.LATE,
        }),
      });
      expect(database.dossier.update.mock.calls[0][0].data).not.toHaveProperty(
        'status',
      );
    });
  });

  describe('actions', () => {
    it('lists what the role allows, blocked with its reason, and hides the rest', async () => {
      database.instruction.count.mockResolvedValue(2);
      const actions = await asPerson(
        ['dossier.update', 'dossier.close', 'dossier.archive'],
        () =>
          service.actionsOf({ id: 'd-1', status: DossierStatus.IN_PROGRESS }),
      );
      expect(actions).toEqual([
        { action: 'edit', enabled: true },
        {
          action: 'close',
          enabled: false,
          reason: 'INSTRUCTIONS_OPEN',
          params: { count: '2' },
        },
        {
          action: 'archive',
          enabled: false,
          reason: 'WRONG_STATUS',
          params: { status: DossierStatus.IN_PROGRESS },
        },
        {
          action: 'unarchive',
          enabled: false,
          reason: 'WRONG_STATUS',
          params: { status: DossierStatus.IN_PROGRESS },
        },
      ]);
    });

    it('blocks closing while a courrier awaits validation', async () => {
      database.instruction.count.mockResolvedValue(0);
      database.courrier.count.mockResolvedValue(1);
      const actions = await asPerson(['dossier.close'], () =>
        service.actionsOf({ id: 'd-1', status: DossierStatus.OPEN }),
      );
      expect(actions).toEqual([
        {
          action: 'close',
          enabled: false,
          reason: 'PREREQUISITE_MISSING',
          params: { missing: 'COURRIER_VALIDATION', count: '1' },
        },
      ]);
    });
  });

  describe('getProgression', () => {
    it('computes progress as done/total non-cancelled instructions, read-only', async () => {
      database.dossier.findUnique.mockResolvedValue({ id: 'd-1' });
      database.instruction.count
        .mockResolvedValueOnce(4) // total
        .mockResolvedValueOnce(2); // done (TERMINEE)
      database.dossier.update.mockResolvedValue({});

      const result = await service.getProgression('d-1');

      expect(result).toEqual({ total: 4, done: 2, progress: 50 });
      expect(database.dossier.update).not.toHaveBeenCalled();
    });
  });
});
