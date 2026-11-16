import { Test, TestingModule } from '@nestjs/testing';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { ActivityService } from '../../activity/activity.service';
import { AccessService } from '../../auth/access/access.service';
import { DatabaseService } from '../../database/database.service';
import { NotificationsService } from '../../notifications/notifications.service';
import { ClsServiceManager } from 'nestjs-cls';
import { WorkflowService } from '../../workflow/workflow.service';
import { ProjectService } from './project.service';
import { accessMock, AccessMock } from '../access-mock.testing-spec';

// Runs as a signed-in person holding `permissions` (the workflow engine checks them).
const asPerson = <T>(
  fn: () => Promise<T>,
  permissions = ['project.update', 'project.archive'],
) => {
  const cls = ClsServiceManager.getClsService();
  return cls.run(() => {
    cls.set('permissions', permissions);
    return fn();
  });
};

describe('ProjectService', () => {
  let service: ProjectService;
  let database: {
    project: Record<string, jest.Mock>;
    correspondent: Record<string, jest.Mock>;
    projectAccess: Record<string, jest.Mock>;
    user: Record<string, jest.Mock>;
    contract: Record<string, jest.Mock>;
    dossier: Record<string, jest.Mock>;
    analysisSheet: Record<string, jest.Mock>;
    courrier: Record<string, jest.Mock>;
    instruction: Record<string, jest.Mock>;
    statusHistory: { create: jest.Mock };
    $transaction: jest.Mock;
  };
  let access: AccessMock;

  const project = (over: Record<string, unknown> = {}) => ({
    id: 'p-1',
    status: 'ACTIVE',
    responsibleId: 'u-resp',
    companyId: 's-1',
    maitreOuvrageId: null,
    startDate: null,
    endDate: null,
    ...over,
  });
  const updatedData = () =>
    (
      database.project.update.mock.calls[0][0] as {
        data: Record<string, unknown>;
      }
    ).data;

  beforeEach(async () => {
    database = {
      project: {
        create: jest.fn().mockResolvedValue({ id: 'p-new' }),
        findUnique: jest.fn().mockResolvedValue(project()),
        update: jest.fn().mockResolvedValue({ id: 'p-1' }),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        count: jest.fn().mockResolvedValue(1),
      },
      correspondent: {
        findFirst: jest.fn().mockResolvedValue(null),
        findMany: jest.fn().mockResolvedValue([]),
        create: jest.fn().mockResolvedValue({ id: 'c-new' }),
      },
      projectAccess: {
        deleteMany: jest.fn(),
        createMany: jest.fn(),
        count: jest.fn().mockResolvedValue(0),
      },
      user: {
        findMany: jest.fn().mockResolvedValue([]),
        findUnique: jest.fn().mockResolvedValue({ companyId: 's-1' }),
      },
      contract: {
        count: jest.fn().mockResolvedValue(0),
        findMany: jest.fn().mockResolvedValue([]),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      dossier: {
        count: jest.fn().mockResolvedValue(0),
        findMany: jest.fn().mockResolvedValue([]),
        update: jest.fn(),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      courrier: {
        count: jest.fn().mockResolvedValue(0),
        findMany: jest.fn().mockResolvedValue([]),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      instruction: {
        count: jest.fn().mockResolvedValue(0),
        findFirst: jest.fn().mockResolvedValue(null),
        findMany: jest.fn().mockResolvedValue([]),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      analysisSheet: {
        findMany: jest.fn().mockResolvedValue([]),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      statusHistory: { create: jest.fn() },
      $transaction: jest.fn((work: unknown) =>
        typeof work === 'function'
          ? (work as (tx: unknown) => unknown)(database)
          : Promise.all(work as unknown[]),
      ),
    };
    // Every permission, in their company s-1.
    access = accessMock();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ProjectService,
        WorkflowService,
        { provide: DatabaseService, useValue: database },
        { provide: AccessService, useValue: access },
        {
          provide: NotificationsService,
          useValue: { notifyAccessChanged: jest.fn() },
        },
        {
          provide: ActivityService,
          useValue: { tryRecord: jest.fn(), findAll: jest.fn() },
        },
      ],
    }).compile();

    service = module.get<ProjectService>(ProjectService);
  });

  describe('who may open a project', () => {
    it('hides a project restricted to others (404)', async () => {
      database.project.count.mockResolvedValue(0);

      await expect(service.findOneFor('p-1', 'u-1')).rejects.toBeInstanceOf(
        NotFoundException,
      );
      expect(database.project.count).toHaveBeenCalledWith({
        where: {
          id: 'p-1',
          AND: [
            {
              companyId: 's-1',
              OR: [
                { accesses: { none: {} } },
                { responsibleId: 'u-1' },
                { accesses: { some: { userId: 'u-1' } } },
              ],
            },
          ],
        },
      });
    });

    it('shows nothing to someone without a company', async () => {
      access.state.companyId = null;
      database.project.count.mockResolvedValue(0);

      await expect(service.findOneFor('p-1', 'admin')).rejects.toBeInstanceOf(
        NotFoundException,
      );
      expect(database.project.count).toHaveBeenCalledWith({
        where: {
          id: 'p-1',
          AND: [expect.objectContaining({ companyId: { in: [] } })],
        },
      });
    });

    it('only the responsible or an administrator changes the list', async () => {
      access.state.permissions = ['project.read'];
      await expect(
        service.setAccess('p-1', ['u-2'], 'u-1'),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('refuses an inactive user on the list', async () => {
      database.user.findMany.mockResolvedValueOnce([]);
      database.user.findMany.mockResolvedValueOnce([
        { id: 'u-2', status: 'SUSPENDED' },
      ]);

      await expect(
        service.setAccess('p-1', ['u-2'], 'u-resp'),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(database.projectAccess.deleteMany).not.toHaveBeenCalled();
    });
  });

  describe('project page', () => {
    it('counts only the overdue tasks of this project', async () => {
      await service.findOneFor('p-1', 'u-1');

      const where = (
        database.instruction.count.mock.calls[0][0] as {
          where: { AND: Record<string, unknown>[] };
        }
      ).where;
      expect(where.AND[0]).toEqual({
        OR: [
          { dossier: { projectId: 'p-1' } },
          { contract: { projectId: 'p-1' } },
        ],
      });
      expect(where.AND[1]).toHaveProperty('OR');
    });
  });

  describe('archiving', () => {
    it('keeps the reason when archiving a closed project', async () => {
      database.project.findUnique.mockResolvedValue(
        project({ status: 'CLOSED' }),
      );

      await asPerson(() =>
        service.update(
          'p-1',
          { status: 'ARCHIVED', reason: 'Terminé' },
          'u-admin',
        ),
      );

      // Through the workflow engine, conditional on the status read.
      expect(database.project.updateMany).toHaveBeenCalledWith({
        where: { id: 'p-1', status: 'CLOSED' },
        data: expect.objectContaining({
          status: 'ARCHIVED',
          archiveReason: 'Terminé',
        }),
      });
      expect(database.statusHistory.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          entity: 'Project',
          event: 'ARCHIVE',
          reason: 'Terminé',
        }),
      });
      expect(updatedData()).not.toHaveProperty('status');
    });

    it('clears the reason when unarchiving', async () => {
      database.project.findUnique.mockResolvedValue(
        project({ status: 'ARCHIVED' }),
      );

      await asPerson(() =>
        service.update('p-1', { status: 'CLOSED' }, 'u-admin'),
      );

      expect(database.project.updateMany).toHaveBeenCalledWith({
        where: { id: 'p-1', status: 'ARCHIVED' },
        data: { status: 'CLOSED', archivedAt: null, archiveReason: null },
      });
    });

    it('closes what the project holds, keeping what each task was', async () => {
      database.instruction.findMany.mockResolvedValue([
        { id: 'i-1', status: 'EN_COURS' },
      ]);
      database.dossier.findMany.mockResolvedValue([
        { id: 'd-1', status: 'IN_PROGRESS' },
      ]);

      await asPerson(() =>
        service.update('p-1', { status: 'CLOSED' }, 'u-admin'),
      );

      expect(database.instruction.updateMany).toHaveBeenCalledWith({
        where: { id: 'i-1', status: 'EN_COURS' },
        data: expect.objectContaining({
          status: 'ANNULEE',
          statusBeforeProjectClosure: 'EN_COURS',
        }),
      });
      expect(database.dossier.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'd-1', status: 'IN_PROGRESS' },
          data: expect.objectContaining({ status: 'CLOSED' }),
        }),
      );
      // Each cascaded row is a system change in StatusHistory.
      expect(database.statusHistory.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          entity: 'Instruction',
          event: 'CANCEL_BY_PROJECT',
          actorId: null,
          companyId: 's-1',
        }),
      });
    });

    it('gives a task back its status on reopening', async () => {
      database.project.findUnique.mockResolvedValue(
        project({ status: 'CLOSED', closedAt: new Date() }),
      );
      database.instruction.findMany.mockResolvedValue([
        {
          id: 'i-1',
          status: 'ANNULEE',
          statusBeforeProjectClosure: 'EN_COURS',
        },
      ]);

      await asPerson(() =>
        service.update('p-1', { status: 'ACTIVE' }, 'u-admin'),
      );

      expect(database.instruction.updateMany).toHaveBeenCalledWith({
        where: { id: 'i-1', status: 'ANNULEE' },
        data: {
          status: 'EN_COURS',
          cancellationReason: null,
          statusBeforeProjectClosure: null,
        },
      });
    });

    it('archives its contracts and fiches with it', async () => {
      database.project.findUnique.mockResolvedValue(
        project({ status: 'CLOSED' }),
      );
      database.analysisSheet.findMany.mockResolvedValue([
        { id: 'a-1', status: 'SIGNEE' },
      ]);
      database.contract.findMany.mockResolvedValue([
        { id: 'k-1', status: 'ACTIVE' },
      ]);

      await asPerson(() =>
        service.update('p-1', { status: 'ARCHIVED' }, 'u-admin'),
      );

      expect(database.contract.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'k-1', status: 'ACTIVE' },
          data: expect.objectContaining({ status: 'ARCHIVED' }),
        }),
      );
      expect(database.analysisSheet.updateMany).toHaveBeenCalledWith({
        where: { id: 'a-1', status: 'SIGNEE' },
        data: expect.objectContaining({
          status: 'ARCHIVEE',
          archivedFromStatus: 'SIGNEE',
        }),
      });
    });

    it('refuses a reason without archiving', async () => {
      await expect(
        service.update('p-1', { reason: 'Pourquoi pas' }, 'u-admin'),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('refuses to skip a step (409 INVALID_TRANSITION)', async () => {
      await expect(
        asPerson(() =>
          service.update('p-1', { status: 'ARCHIVED' }, 'u-admin'),
        ),
      ).rejects.toMatchObject({
        response: {
          code: 'INVALID_TRANSITION',
          params: { entity: 'Project', from: 'ACTIVE', event: 'ARCHIVE' },
        },
      });
      expect(database.project.updateMany).not.toHaveBeenCalled();
    });

    it('refuses closing to someone without project.update', async () => {
      await expect(
        asPerson(
          () => service.update('p-1', { status: 'CLOSED' }, 'u-admin'),
          ['project.archive'],
        ),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('lists the actions the role allows on the page', async () => {
      const actions = await asPerson(
        () => service.findOneFor('p-1', 'u-1'),
        ['project.update'],
      );
      expect(actions.actions).toEqual([
        { action: 'edit', enabled: true },
        { action: 'close', enabled: true },
        {
          action: 'reopen',
          enabled: false,
          reason: 'WRONG_STATUS',
          params: { status: 'ACTIVE' },
        },
      ]);
    });
  });

  describe('its content type', () => {
    const ofType = (contentType: 'DOSSIERS' | 'CONTRATS') =>
      database.project.findUnique.mockResolvedValue({
        ...project(),
        contentType,
      });

    it('refuses CONTRATS while it holds dossiers outside any contract', async () => {
      ofType('DOSSIERS');
      database.dossier.count.mockResolvedValue(2);

      await expect(
        service.update('p-1', { contentType: 'CONTRATS' }, 'u-admin'),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(database.dossier.count).toHaveBeenCalledWith({
        where: { projectId: 'p-1', contractId: null },
      });
    });

    it('refuses DOSSIERS while it holds contracts', async () => {
      ofType('CONTRATS');
      database.contract.count.mockResolvedValue(1);

      await expect(
        service.update('p-1', { contentType: 'DOSSIERS' }, 'u-admin'),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('changes when nothing is in the way', async () => {
      ofType('DOSSIERS');

      await service.update('p-1', { contentType: 'CONTRATS' }, 'u-admin');

      expect(updatedData().contentType).toBe('CONTRATS');
    });
  });

  describe("maître d'ouvrage by name", () => {
    it('reuses the correspondent with that name', async () => {
      database.correspondent.findMany.mockResolvedValue([
        {
          id: 'c-1',
          name: 'Port Autonome',
          status: 'ACTIVE',
          companyId: 's-1',
        },
      ]);

      await service.update(
        'p-1',
        { maitreOuvrageName: 'port autonome' },
        'u-admin',
      );

      expect(database.correspondent.create).not.toHaveBeenCalled();
      expect(updatedData().maitreOuvrageId).toBe('c-1');
    });

    it("creates it on the project's company when there is none", async () => {
      await service.update(
        'p-1',
        { maitreOuvrageName: 'Mairie de Kribi' },
        'u-admin',
      );

      expect(database.correspondent.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            name: 'Mairie de Kribi',
            companyId: 's-1',
          }),
        }),
      );
      expect(updatedData().maitreOuvrageId).toBe('c-new');
    });
  });
});
