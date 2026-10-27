import { Test, TestingModule } from '@nestjs/testing';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { InstructionsService } from './instructions.service';
import { DatabaseService } from '../database/database.service';
import { NotificationsService } from '../notifications/notifications.service';
import { InstructionStatus } from '../../generated/prisma/client';

// Dossier-state rules (RG-DOS-007, site activity, progress) are covered by
// the DossierService spec; here they're stubbed so fixtures don't need a
// full dossier/site graph.
jest.mock('../common/utils/dossier-lifecycle', () => ({
  assertDossierOpenForActivity: jest.fn(),
  markDossierInProgress: jest.fn(),
  refreshDossierProgress: jest.fn(),
}));

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
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
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
    it('waits for its executants to accept it (AFFECTEE)', async () => {
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

    it('stays A_AFFECTER with only a superviseur, until executants are designated', async () => {
      database.instruction.create.mockResolvedValue({
        id: 'i-1',
        dossierId: 'd-1',
      });

      await service.create(
        { dossierId: 'd-1', title: 'X', superviseurId: 'u-sup' },
        'creator-1',
      );

      expect(database.instruction.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status: InstructionStatus.A_AFFECTER,
          }),
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

    it('creates initial livrables along with the instruction', async () => {
      database.instruction.create.mockResolvedValue({
        id: 'i-1',
        dossierId: 'd-1',
      });

      await service.create(
        {
          dossierId: 'd-1',
          title: 'X',
          livrables: [{ title: 'Rapport' }],
        },
        'creator-1',
      );

      expect(database.instruction.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            livrables: {
              createMany: {
                data: [{ title: 'Rapport', description: undefined, createdById: 'creator-1' }],
              },
            },
          }),
        }),
      );
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

    it('creates the sub-task dependency when dependsOnId is given', async () => {
      database.instruction.findUnique.mockResolvedValue({ id: 'parent-1' });
      database.instruction.create.mockResolvedValue({
        id: 'i-1',
        dossierId: 'd-1',
      });

      await service.create(
        { dossierId: 'd-1', title: 'X', dependsOnId: 'parent-1' },
        'creator-1',
      );

      expect(database.instruction.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            dependsOn: { create: { dependsOnId: 'parent-1' } },
          }),
        }),
      );
    });

    it('refuses when the parent task does not exist', async () => {
      database.instruction.findUnique.mockResolvedValue(null);

      await expect(
        service.create(
          { dossierId: 'd-1', title: 'X', dependsOnId: 'missing' },
          'creator-1',
        ),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(database.instruction.create).not.toHaveBeenCalled();
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
        status: InstructionStatus.EN_COURS,
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
    it('records the motif and reassigns to the new executant, who accepts in turn (RG-INS-003/004)', async () => {
      database.instruction.findUnique.mockResolvedValue({
        id: 'i-1',
        dossierId: 'd-1',
        status: InstructionStatus.EN_COURS,
      });
      database.instruction.update.mockResolvedValue({
        id: 'i-1',
        dossierId: 'd-1',
        status: InstructionStatus.EN_COURS,
      });

      await service.refuse('i-1', {
        motif: 'Trop de charge',
        newAssigneeId: 'u-9',
      });

      expect(database.instruction.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status: InstructionStatus.AFFECTEE,
            refusalReason: 'Trop de charge',
            assignees: {
              deleteMany: { role: 'EXECUTANT' },
              create: { userId: 'u-9', role: 'EXECUTANT' },
            },
          }),
        }),
      );
      expect(database.dossierAccess.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { dossierId_userId: { dossierId: 'd-1', userId: 'u-9' } },
        }),
      );
    });
  });

  describe('accept', () => {
    const assigned = {
      id: 'i-1',
      title: 'Rédiger le rapport',
      dossierId: 'd-1',
      courrierId: null,
      createdById: 'creator-1',
      status: InstructionStatus.AFFECTEE,
      assignees: [
        { role: 'EXECUTANT', user: { id: 'u-exec', name: 'Awa' } },
        { role: 'SUPERVISEUR', user: { id: 'u-sup', name: 'Paul' } },
      ],
    };

    beforeEach(() =>
      database.instruction.findUnique.mockResolvedValue(assigned),
    );

    it('lets an executant accept it, and tells the creator and the superviseur', async () => {
      await service.accept('i-1', 'u-exec');

      expect(database.instruction.updateMany).toHaveBeenCalledWith({
        where: { id: 'i-1', status: InstructionStatus.AFFECTEE },
        data: { status: InstructionStatus.EN_COURS },
      });
      expect(notifications.create).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'TASK_ACCEPTED',
          recipientIds: ['creator-1', 'u-sup'],
        }),
      );
    });

    it.each([
      ['the superviseur', 'u-sup'],
      ['someone not on the task', 'u-other'],
    ])('refuses %s', async (_label, userId) => {
      await expect(service.accept('i-1', userId)).rejects.toBeInstanceOf(
        ForbiddenException,
      );
      expect(database.instruction.updateMany).not.toHaveBeenCalled();
    });

    it('refuses a task that is not waiting to be accepted', async () => {
      database.instruction.findUnique.mockResolvedValue({
        ...assigned,
        status: InstructionStatus.EN_COURS,
      });

      await expect(service.accept('i-1', 'u-exec')).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });

    it('accepts it only once when two executants accept together', async () => {
      database.instruction.updateMany.mockResolvedValue({ count: 0 });

      await expect(service.accept('i-1', 'u-exec')).rejects.toBeInstanceOf(
        ConflictException,
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
