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

  // Projects come from the CREAPP core (2026-11-23): their status changes there, the
  // consequences on the contents are tested in src/core/project-sync.spec.ts.
  describe('copies of the core', () => {
    it("offers only Diffusion's settings of the project on its page", async () => {
      const page = await asPerson(
        () => service.findOneFor('p-1', 'u-1'),
        ['project.update'],
      );
      expect(page.actions).toEqual([{ action: 'edit', enabled: true }]);
    });

    it('offers nothing to someone without project.update', async () => {
      access.state.permissions = ['project.read'];
      const page = await asPerson(
        () => service.findOneFor('p-1', 'u-1'),
        ['project.read'],
      );
      expect(page.actions).toEqual([]);
    });

    it("writes only Diffusion's own fields", async () => {
      await service.update('p-1', { mode: 'Marché public' }, 'u-admin');

      expect(updatedData()).toEqual({
        mode: 'Marché public',
        maitreOuvrageId: undefined,
      });
      expect(database.project.updateMany).not.toHaveBeenCalled();
      expect(database.statusHistory.create).not.toHaveBeenCalled();
    });

    it('lists several statuses at once (the pickers: ACTIVE,SUSPENDED)', async () => {
      database.project.findMany = jest.fn().mockResolvedValue([]);
      database.project.groupBy = jest.fn().mockResolvedValue([]);
      await service.findAll({ statuses: 'ACTIVE,SUSPENDED,BOGUS' }, 'u-1');

      expect(database.project.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            status: { in: ['ACTIVE', 'SUSPENDED'] },
          }),
        }),
      );
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
