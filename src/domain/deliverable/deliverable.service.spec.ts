import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { DeliverableService } from './deliverable.service';
import { DatabaseService } from '../../database/database.service';
import { RbacService } from '../../auth/rbac/rbac.service';
import {
  InstructionStatus,
  LivrableStatus,
} from '../../../generated/prisma/client';

// Dossier-state rules (RG-DOS-007, site activity, progress) are covered by
// the DossierService spec; here they're stubbed so fixtures don't need a
// full dossier/site graph.
jest.mock('../../common/utils/dossier-lifecycle', () => ({
  assertDossierOpenForActivity: jest.fn(),
  markDossierInProgress: jest.fn(),
  refreshDossierProgress: jest.fn(),
}));

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
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        delete: jest.fn(),
      },
      instruction: {
        updateMany: jest.fn(),
        findUnique: jest.fn().mockResolvedValue({ dossierId: 'd-1' }),
        findUniqueOrThrow: jest
          .fn()
          .mockResolvedValue({ status: InstructionStatus.EN_COURS }),
      },
      // Array form (batched writes) or callback form (interactive).
      $transaction: jest.fn((arg: unknown) =>
        typeof arg === 'function'
          ? (arg as (tx: unknown) => unknown)(database)
          : Promise.all(arg as unknown[]),
      ),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DeliverableService,
        { provide: DatabaseService, useValue: database },
        { provide: RbacService, useValue: {} },
      ],
    }).compile();

    service = module.get<DeliverableService>(DeliverableService);
  });

  it('is defined', () => {
    expect(service).toBeDefined();
  });

  describe('create', () => {
    it('allows a livrable on a task not accepted yet (AFFECTEE)', async () => {
      database.instruction.findUnique.mockResolvedValue({
        dossierId: 'd-1',
        status: InstructionStatus.AFFECTEE,
      });
      database.livrable.create.mockResolvedValue({ id: 'l-1' });

      await service.create({ instructionId: 'i-1', title: 'Rapport' }, 'u-1');
      expect(database.livrable.create).toHaveBeenCalled();
    });

    it('refuses a livrable on a terminal task (TERMINEE)', async () => {
      database.instruction.findUnique.mockResolvedValue({
        dossierId: 'd-1',
        status: InstructionStatus.TERMINEE,
      });

      await expect(
        service.create({ instructionId: 'i-1', title: 'Rapport' }, 'u-1'),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(database.livrable.create).not.toHaveBeenCalled();
    });
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
    // A rejected v1, still the current version.
    const rejected = {
      id: 'l-1',
      instructionId: 'i-1',
      title: 'Rapport',
      description: null,
      version: 1,
      isLatest: true,
      status: LivrableStatus.REJETE,
    };

    it('creates a new livrable pointing at the previous one', async () => {
      database.livrable.findUnique.mockResolvedValue(rejected);
      database.livrable.create.mockResolvedValue({ id: 'l-2', version: 2 });

      await service.newVersion('l-1', {}, 'u-1');

      expect(database.livrable.updateMany).toHaveBeenCalledWith({
        where: { id: 'l-1', isLatest: true },
        data: { isLatest: false },
      });
      expect(database.livrable.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            version: 2,
            parentVersionId: 'l-1',
          }),
        }),
      );
    });

    it('only answers a rejection', async () => {
      database.livrable.findUnique.mockResolvedValue({
        ...rejected,
        status: LivrableStatus.SOUMIS,
      });

      await expect(service.newVersion('l-1', {}, 'u-1')).rejects.toBeInstanceOf(
        BadRequestException,
      );
      expect(database.livrable.create).not.toHaveBeenCalled();
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

    it('refuses while nobody has subscribed to the task', async () => {
      database.livrable.findUnique.mockResolvedValue({
        id: 'l-1',
        instructionId: 'i-1',
        status: LivrableStatus.DEPOSE,
      });
      database.instruction.findUniqueOrThrow.mockResolvedValue({
        status: InstructionStatus.AFFECTEE,
      });

      await expect(service.submit('l-1')).rejects.toBeInstanceOf(
        BadRequestException,
      );
      expect(database.livrable.update).not.toHaveBeenCalled();
    });
  });
});
