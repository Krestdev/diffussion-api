import { Test, TestingModule } from '@nestjs/testing';
import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { ActivityService } from '../../activity/activity.service';
import { RbacService } from '../../auth/rbac/rbac.service';
import { DatabaseService } from '../../database/database.service';
import { ProjectService } from './project.service';

describe('ProjectService', () => {
  let service: ProjectService;
  let database: {
    project: Record<string, jest.Mock>;
    correspondent: Record<string, jest.Mock>;
    projectAccess: Record<string, jest.Mock>;
    user: Record<string, jest.Mock>;
    contract: Record<string, jest.Mock>;
    dossier: Record<string, jest.Mock>;
    courrier: Record<string, jest.Mock>;
    instruction: Record<string, jest.Mock>;
    $transaction: jest.Mock;
  };
  let rbac: { hasGlobalPermission: jest.Mock; managedSites: jest.Mock };

  const project = (over: Record<string, unknown> = {}) => ({
    id: 'p-1',
    status: 'ACTIVE',
    responsibleId: 'u-resp',
    siteId: 's-1',
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
        findUnique: jest.fn().mockResolvedValue({ siteId: 's-1' }),
      },
      contract: { count: jest.fn().mockResolvedValue(0) },
      dossier: { count: jest.fn().mockResolvedValue(0) },
      courrier: { count: jest.fn().mockResolvedValue(0) },
      instruction: {
        count: jest.fn().mockResolvedValue(0),
        findFirst: jest.fn().mockResolvedValue(null),
      },
      $transaction: jest.fn((ops: unknown[]) => Promise.all(ops)),
    };
    rbac = {
      hasGlobalPermission: jest.fn().mockResolvedValue(false),
      managedSites: jest.fn().mockResolvedValue('ALL'),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ProjectService,
        { provide: DatabaseService, useValue: database },
        { provide: RbacService, useValue: rbac },
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
              siteId: 's-1',
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

    it('does not filter for a platform administrator', async () => {
      rbac.hasGlobalPermission.mockResolvedValue(true);
      database.project.count.mockResolvedValue(0);

      await expect(service.findOneFor('p-1', 'admin')).rejects.toBeInstanceOf(
        NotFoundException,
      );
      expect(database.project.count).toHaveBeenCalledWith({
        where: { id: 'p-1', AND: [{}] },
      });
    });

    it('only the responsible or an administrator changes the list', async () => {
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

      await service.update(
        'p-1',
        { status: 'ARCHIVED', reason: 'Terminé' },
        'u-admin',
      );

      expect(updatedData()).toMatchObject({
        status: 'ARCHIVED',
        archiveReason: 'Terminé',
      });
    });

    it('clears the reason when unarchiving', async () => {
      database.project.findUnique.mockResolvedValue(
        project({ status: 'ARCHIVED' }),
      );

      await service.update('p-1', { status: 'CLOSED' }, 'u-admin');

      expect(updatedData()).toMatchObject({
        status: 'CLOSED',
        archivedAt: null,
        archiveReason: null,
      });
    });

    it('refuses a reason without archiving', async () => {
      await expect(
        service.update('p-1', { reason: 'Pourquoi pas' }, 'u-admin'),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('refuses to skip a step', async () => {
      await expect(
        service.update('p-1', { status: 'ARCHIVED' }, 'u-admin'),
      ).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  describe("maître d'ouvrage by name", () => {
    it('reuses the correspondent with that name', async () => {
      database.correspondent.findMany.mockResolvedValue([
        { id: 'c-1', name: 'Port Autonome', status: 'ACTIVE', siteId: 's-1' },
      ]);

      await service.update(
        'p-1',
        { maitreOuvrageName: 'port autonome' },
        'u-admin',
      );

      expect(database.correspondent.create).not.toHaveBeenCalled();
      expect(updatedData().maitreOuvrageId).toBe('c-1');
    });

    it("creates it on the project's site when there is none", async () => {
      await service.update(
        'p-1',
        { maitreOuvrageName: 'Mairie de Kribi' },
        'u-admin',
      );

      expect(database.correspondent.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            name: 'Mairie de Kribi',
            siteId: 's-1',
          }),
        }),
      );
      expect(updatedData().maitreOuvrageId).toBe('c-new');
    });
  });
});
