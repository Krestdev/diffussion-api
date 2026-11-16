import { WorkflowService } from '../../workflow/workflow.service';
import { ClsServiceManager } from 'nestjs-cls';
import { Permission } from '../../auth/permissions';
import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, ConflictException } from '@nestjs/common';
import { DeliverableService } from './deliverable.service';
import { DatabaseService } from '../../database/database.service';
import { AccessService } from '../../auth/access/access.service';
import { ActivityService } from '../../activity/activity.service';
import {
  InstructionStatus,
  LivrableStatus,
} from '../../../generated/prisma/client';

// Dossier-state rules (RG-DOS-007, company activity, progress) are covered by
// the DossierService spec; here they're stubbed so fixtures don't need a
// full dossier/company graph.
jest.mock('../../common/utils/dossier-lifecycle', () => ({
  assertDossierOpenForActivity: jest.fn(),
  markDossierInProgress: jest.fn(),
  refreshDossierProgress: jest.fn(),
}));

// The signed-in person, as CoreAuthGuard puts them in the request context: the
// workflow engine checks its rules' permissions against theirs.
const signedIn: Record<string, unknown> = {};
beforeEach(() => {
  for (const key of Object.keys(signedIn)) delete signedIn[key];
  Object.assign(signedIn, {
    userId: 'u-signed-in',
    companyId: 'company-1',
    permissions: Object.values(Permission),
  });
  jest.spyOn(ClsServiceManager, 'getClsService').mockReturnValue({
    isActive: () => true,
    get: (key: string) => signedIn[key],
  } as never);
});
afterEach(() => jest.restoreAllMocks());

describe('DeliverableService', () => {
  let service: DeliverableService;
  let database: {
    livrable: Record<string, jest.Mock>;
    instruction: Record<string, jest.Mock>;
    statusHistory: Record<string, jest.Mock>;
    $transaction: jest.Mock;
  };
  let access: { companyFilter: jest.Mock };

  beforeEach(async () => {
    // A global grant unless a test says otherwise.
    access = { companyFilter: jest.fn().mockResolvedValue({}) };
    database = {
      livrable: {
        create: jest.fn(),
        findUnique: jest.fn(),
        findMany: jest.fn(),
        count: jest.fn(),
        update: jest.fn(),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        findUniqueOrThrow: jest.fn().mockResolvedValue({ id: 'l-1' }),
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
      statusHistory: { create: jest.fn().mockResolvedValue({}) },
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
        WorkflowService,
        { provide: DatabaseService, useValue: database },
        { provide: AccessService, useValue: access },
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

    it("also lists the livrables of a contract's task, which has no company", async () => {
      access.companyFilter.mockImplementation((_u, _code, toWhere) =>
        Promise.resolve(toWhere({ in: ['s-1'] })),
      );

      await service.findAll({ instructionId: 'i-1' }, 'u-1');

      const or = listed().OR as Record<string, unknown>[];
      expect(or[0]).toEqual({
        instruction: { dossier: { companyId: { in: ['s-1'] } } },
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

      database.livrable.create.mockResolvedValue({
        id: 'l-3',
        status: LivrableStatus.EN_PREPARATION,
      });

      await service.create({ instructionId: 'i-1', title: 'Annexe' }, 'u-1');

      expect(database.livrable.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ position: 2 }),
        }),
      );
      // Its creation status is recorded (StatusHistory).
      expect(database.statusHistory.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          entity: 'Livrable',
          entityId: 'l-3',
          fromStatus: null,
          toStatus: LivrableStatus.EN_PREPARATION,
          event: 'CREATE',
        }),
      });
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
      database.instruction.updateMany.mockResolvedValue({ count: 1 });

      await service.submit('l-1');

      expect(database.livrable.updateMany).toHaveBeenCalledWith({
        where: { id: 'l-1', status: LivrableStatus.DEPOSE },
        data: { validationStep: 0, status: LivrableStatus.SOUMIS },
      });
      expect(database.instruction.updateMany).toHaveBeenCalledWith({
        where: { id: 'i-1', status: InstructionStatus.EN_COURS },
        data: { status: InstructionStatus.EN_ATTENTE_VALIDATION },
      });
      expect(database.statusHistory.create).toHaveBeenCalledTimes(2);
    });

    it('refuses a livrable that is not deposited (409 INVALID_TRANSITION)', async () => {
      database.livrable.findUnique.mockResolvedValue({
        id: 'l-1',
        instructionId: 'i-1',
        status: LivrableStatus.EN_PREPARATION,
      });

      await expect(service.submit('l-1')).rejects.toBeInstanceOf(
        ConflictException,
      );
      expect(database.livrable.updateMany).not.toHaveBeenCalled();
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

      // 409 INVALID_TRANSITION (the workflow engine), formerly 400.
      await expect(service.submit('l-1')).rejects.toBeInstanceOf(
        ConflictException,
      );
      expect(database.livrable.updateMany).not.toHaveBeenCalled();
    });
  });
});
