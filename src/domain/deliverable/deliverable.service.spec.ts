import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { DeliverableService } from './deliverable.service';
import { DatabaseService } from '../../database/database.service';
import { LivrableStatus } from '../../../generated/prisma/client';

describe('DeliverableService', () => {
  let service: DeliverableService;
  let database: {
    livrable: Record<string, jest.Mock>;
    instruction: Record<string, jest.Mock>;
    $transaction: jest.Mock;
  };

  beforeEach(async () => {
    database = {
      livrable: {
        create: jest.fn(),
        findUnique: jest.fn(),
        findMany: jest.fn(),
        count: jest.fn(),
        update: jest.fn(),
        delete: jest.fn(),
      },
      instruction: { updateMany: jest.fn() },
      $transaction: jest.fn((ops: unknown[]) => Promise.all(ops)),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DeliverableService,
        { provide: DatabaseService, useValue: database },
      ],
    }).compile();

    service = module.get<DeliverableService>(DeliverableService);
  });

  it('is defined', () => {
    expect(service).toBeDefined();
  });

  describe('update', () => {
    it('refuses to edit in place once deposited (RG-LIV-007)', async () => {
      database.livrable.findUnique.mockResolvedValue({
        id: 'l-1',
        status: LivrableStatus.DEPOSE,
      });

      await expect(
        service.update('l-1', { title: 'New title' }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  describe('newVersion', () => {
    it('creates a new livrable pointing at the previous one', async () => {
      database.livrable.findUnique.mockResolvedValue({
        id: 'l-1',
        instructionId: 'i-1',
        title: 'Rapport',
        description: null,
        version: 1,
      });
      database.livrable.create.mockResolvedValue({ id: 'l-2', version: 2 });

      await service.newVersion('l-1', {}, 'u-1');

      expect(database.livrable.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            version: 2,
            parentVersionId: 'l-1',
          }),
        }),
      );
    });
  });

  describe('submit', () => {
    it('moves the parent instruction to EN_ATTENTE_VALIDATION', async () => {
      database.livrable.findUnique.mockResolvedValue({
        id: 'l-1',
        instructionId: 'i-1',
        status: LivrableStatus.DEPOSE,
      });
      database.livrable.update.mockResolvedValue({
        id: 'l-1',
        status: LivrableStatus.SOUMIS,
      });
      database.instruction.updateMany.mockResolvedValue({ count: 1 });

      await service.submit('l-1');

      expect(database.instruction.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ id: 'i-1' }),
          data: { status: 'EN_ATTENTE_VALIDATION' },
        }),
      );
    });
  });
});
