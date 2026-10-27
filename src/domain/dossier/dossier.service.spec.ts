import { Test, TestingModule } from '@nestjs/testing';
import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { DossierService } from './dossier.service';
import { DatabaseService } from '../../database/database.service';
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
      activityLog: { findMany: jest.fn() },
      $transaction: jest.fn((ops: unknown[]) => Promise.all(ops)),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DossierService,
        { provide: DatabaseService, useValue: database },
        { provide: RbacService, useValue: rbac },
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
