import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { DeliverableService } from './deliverable.service';
import { DatabaseService } from '../../database/database.service';
import { RbacService } from '../../auth/rbac/rbac.service';
import { ActivityService } from '../../activity/activity.service';
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
  let rbac: { siteFilter: jest.Mock };

  beforeEach(async () => {
    // A global grant unless a test says otherwise.
    rbac = { siteFilter: jest.fn().mockResolvedValue({}) };
    database = {
      livrable: {
        create: jest.fn(),
        findUnique: jest.fn(),
        findMany: jest.fn(),
        count: jest.fn(),
        update: jest.fn(),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        delete: jest.fn(),
        // The task already has livrables at positions 0 and 1.
        aggregate: jest.fn().mockResolvedValue({ _max: { position: 1 } }),
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
        { provide: RbacService, useValue: rbac },
        {
          provide: ActivityService,
          useValue: { tryRecord: jest.fn().mockResolvedValue('log-1') },
        },
      ],
    }).compile();

    service = module.get<DeliverableService>(DeliverableService);
  });

  it('is defined', () => {
    expect(service).toBeDefined();
  });

  describe('findAll', () => {
    const listed = () =>
      (
        database.livrable.findMany.mock.calls[0][0] as {
          where: Record<string, unknown>;
        }
      ).where;

    beforeEach(() => {
      database.livrable.findMany.mockResolvedValue([]);
      database.livrable.count.mockResolvedValue(0);
    });

    it('lists every livrable of a task for a global reader', async () => {
      await service.findAll({ instructionId: 'i-1' }, 'u-1');

      expect(listed()).toEqual({
        isLatest: true,
        instructionId: 'i-1',
        status: undefined,
      });
    });

    it("also lists the livrables of a contract's task, which has no site", async () => {
      rbac.siteFilter.mockImplementation((_u, _code, toWhere) =>
        Promise.resolve(toWhere({ in: ['s-1'] })),
      );

      await service.findAll({ instructionId: 'i-1' }, 'u-1');

      const or = listed().OR as Record<string, unknown>[];
      expect(or[0]).toEqual({
        instruction: { dossier: { siteId: { in: ['s-1'] } } },
      });
      expect(or[1]).toMatchObject({
        instruction: {
          dossierId: null,
          OR: expect.arrayContaining([
            { createdById: 'u-1' },
            { assignees: { some: { userId: 'u-1' } } },
          ]) as unknown,
        },
      });
    });
  });

  describe('create', () => {
    it('puts a livrable added later after the others', async () => {
      database.instruction.findUnique.mockResolvedValue({
        dossierId: 'd-1',
        status: InstructionStatus.EN_COURS,
      });

      await service.create({ instructionId: 'i-1', title: 'Annexe' }, 'u-1');

      expect(database.livrable.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ position: 2 }),
        }),
      );
    });

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
