import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { DossierService } from './dossier.service';
import { DatabaseService } from '../../database/database.service';
import { DossierStatus } from '../../../generated/prisma/client';

describe('DossierService', () => {
  let service: DossierService;
  let database: {
    dossier: Record<string, jest.Mock>;
    instruction: Record<string, jest.Mock>;
    courrier: Record<string, jest.Mock>;
    livrable: Record<string, jest.Mock>;
    auditLog: Record<string, jest.Mock>;
    $transaction: jest.Mock;
  };

  beforeEach(async () => {
    database = {
      dossier: {
        create: jest.fn(),
        findUnique: jest.fn(),
        findMany: jest.fn(),
        count: jest.fn(),
        update: jest.fn(),
      },
      instruction: { count: jest.fn(), findMany: jest.fn() },
      courrier: { findMany: jest.fn() },
      livrable: { findMany: jest.fn() },
      auditLog: { findMany: jest.fn() },
      $transaction: jest.fn((ops: unknown[]) => Promise.all(ops)),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DossierService,
        { provide: DatabaseService, useValue: database },
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
  });

  describe('update', () => {
    it('refuses to mutate a closed dossier (RG-DOS-007)', async () => {
      database.dossier.findUnique.mockResolvedValue({
        id: 'd-1',
        status: DossierStatus.CLOSED,
      });

      await expect(
        service.update('d-1', { title: 'New title' }),
      ).rejects.toBeInstanceOf(BadRequestException);
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
    it('computes progress as done/total instructions and persists it', async () => {
      database.dossier.findUnique.mockResolvedValue({ id: 'd-1' });
      database.instruction.count
        .mockResolvedValueOnce(4) // total
        .mockResolvedValueOnce(2); // done (TERMINEE)
      database.dossier.update.mockResolvedValue({});

      const result = await service.getProgression('d-1');

      expect(result).toEqual({ total: 4, done: 2, progress: 50 });
      expect(database.dossier.update).toHaveBeenCalledWith({
        where: { id: 'd-1' },
        data: { progress: 50 },
      });
    });
  });
});
