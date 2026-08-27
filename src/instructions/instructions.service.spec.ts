import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { InstructionsService } from './instructions.service';
import { DatabaseService } from '../database/database.service';
import { NotificationsService } from '../notifications/notifications.service';
import { InstructionStatus } from '../../generated/prisma/client';

describe('InstructionsService', () => {
  let service: InstructionsService;
  let notifications: { create: jest.Mock };
  let database: {
    instruction: Record<string, jest.Mock>;
    livrable: Record<string, jest.Mock>;
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
      },
      livrable: { count: jest.fn() },
      dossierAccess: { upsert: jest.fn() },
      courrierAccess: { upsert: jest.fn() },
      $transaction: jest.fn((ops: unknown[]) => Promise.all(ops)),
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
    it('starts AFFECTEE when assignees are provided up front', async () => {
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
        status: InstructionStatus.AFFECTEE,
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

  describe('refuse', () => {
    it('requires a motif and records it (RG-INS-004)', async () => {
      database.instruction.findUnique.mockResolvedValue({
        id: 'i-1',
        status: InstructionStatus.AFFECTEE,
      });
      database.instruction.update.mockResolvedValue({
        id: 'i-1',
        status: InstructionStatus.REFUSEE,
      });

      await service.refuse('i-1', { motif: 'Trop de charge' });

      expect(database.instruction.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status: InstructionStatus.REFUSEE,
            refusalReason: 'Trop de charge',
          }),
        }),
      );
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
