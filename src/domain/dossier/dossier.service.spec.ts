import { Test, TestingModule } from '@nestjs/testing';
import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { DossierService } from './dossier.service';
import { DatabaseService } from '../../database/database.service';
import { NotificationsService } from '../../notifications/notifications.service';
import { RbacService } from '../../auth/rbac/rbac.service';
import { ActivityService } from '../../activity/activity.service';
import { DossierStatus } from '../../../generated/prisma/client';

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
    $transaction: jest.Mock;
  };
  let rbac: { hasPermission: jest.Mock };

  beforeEach(async () => {
    rbac = { hasPermission: jest.fn().mockResolvedValue(false) };
    database = {
      dossier: {
        create: jest.fn(),
        findUnique: jest.fn(),
        findMany: jest.fn(),
        count: jest.fn(),
        update: jest.fn(),
      },
      instruction: { count: jest.fn(), findMany: jest.fn() },
      courrier: { findMany: jest.fn(), count: jest.fn().mockResolvedValue(0) },
      livrable: { findMany: jest.fn() },
      contract: { findUnique: jest.fn() },
      project: {
        findUnique: jest.fn().mockResolvedValue({ name: 'P', siteId: 's-1' }),
      },
      activityLog: { findMany: jest.fn() },
      $transaction: jest.fn((ops: unknown[]) => Promise.all(ops)),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DossierService,
        { provide: DatabaseService, useValue: database },
        { provide: RbacService, useValue: rbac },
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
      database.dossier.update.mockResolvedValue({
        id: 'd-1',
        status: DossierStatus.CLOSED,
      });

      const result = await service.close('d-1');

      expect(database.dossier.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'd-1' },
          data: expect.objectContaining({ status: DossierStatus.CLOSED }),
        }),
      );
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
        siteId: 's-1',
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

    it('refuses to move a dossier to another site without ADMIN_MANAGE_SITES', async () => {
      database.dossier.findUnique.mockResolvedValue({
        id: 'd-1',
        status: DossierStatus.IN_PROGRESS,
        siteId: 's-1',
        responsibleId: 'u-1',
      });

      await expect(
        service.update('d-1', { siteId: 's-2' }, 'u-1'),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(database.dossier.update).not.toHaveBeenCalled();
    });
  });

  describe('contract', () => {
    const openDossier = {
      id: 'd-1',
      status: DossierStatus.IN_PROGRESS,
      siteId: 's-1',
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
          siteId: 's-1',
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

      await expect(service.reopen('d-1')).rejects.toBeInstanceOf(
        BadRequestException,
      );
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
