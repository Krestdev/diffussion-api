import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { InstructionsService } from './instructions.service';
import { DatabaseService } from '../database/database.service';
import { InstructionStatus } from '../../generated/prisma/client';

describe('InstructionsService', () => {
  let service: InstructionsService;
  let database: {
    instruction: Record<string, jest.Mock>;
    livrable: Record<string, jest.Mock>;
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
      $transaction: jest.fn((ops: unknown[]) => Promise.all(ops)),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        InstructionsService,
        { provide: DatabaseService, useValue: database },
      ],
    }).compile();

    service = module.get<InstructionsService>(InstructionsService);
  });

  it('is defined', () => {
    expect(service).toBeDefined();
  });

  describe('create', () => {
    it('starts AFFECTEE when assignees are provided up front', async () => {
      database.instruction.create.mockResolvedValue({ id: 'i-1' });

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
      database.instruction.create.mockResolvedValue({ id: 'i-1' });

      await service.create({ dossierId: 'd-1', title: 'X' }, 'creator-1');

      expect(database.instruction.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status: InstructionStatus.A_AFFECTER,
          }),
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
