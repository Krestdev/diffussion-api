import { ProjectStatus } from '../generated/prisma/client';
import { WorkflowService } from '../workflow/workflow.service';
import type { CoreProject } from './core-client';
import {
  applyProjects,
  cascadeOf,
  dayOf,
  ProjectCascade,
  statusFor,
} from './project-sync';

const NOW = new Date('2026-11-23T10:00:00.000Z');

const coreProject = (over: Partial<CoreProject> = {}): CoreProject => ({
  id: 'p-1',
  reference: 'PRJ-2026-001',
  name: 'Viaduc de la Sanaga',
  description: 'Ouvrage d’art',
  status: 'ONGOING',
  leaderId: 'u-1',
  orgUnitId: null,
  startsOn: '2026-01-01',
  endsOn: '2027-06-30T00:00:00.000Z',
  budget: '1500000',
  ...over,
});

type Row = {
  id: string;
  reference: string | null;
  status: ProjectStatus;
  closedAt: Date | null;
  archivedAt: Date | null;
  coreSyncedAt: Date | null;
};

const row = (over: Partial<Row> = {}): Row => ({
  id: 'p-1',
  reference: 'PRJ-2026-001',
  status: ProjectStatus.ACTIVE,
  closedAt: null,
  archivedAt: null,
  coreSyncedAt: new Date('2026-11-20'),
  ...over,
});

function makeTx(rows: Row[], counts: Record<string, number> = {}) {
  return {
    project: {
      findMany: jest.fn().mockResolvedValue(rows),
      findUnique: jest.fn(({ where }: { where: { id: string } }) =>
        Promise.resolve({
          _count: {
            dossiers: counts[where.id] ?? 0,
            contracts: 0,
            courriers: 0,
            analysisSheets: 0,
          },
        }),
      ),
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    },
    statusHistory: { create: jest.fn() },
    $executeRaw: jest.fn(),
  };
}

const apply = (
  tx: ReturnType<typeof makeTx>,
  projects: CoreProject[],
  people = new Set(['u-1']),
) => applyProjects(tx as never, 'co-1', projects, people, NOW);

describe('project sync (projects from the CREAPP core)', () => {
  it('maps the core statuses on Diffusion’s', () => {
    expect(statusFor('ONGOING', undefined)).toBe(ProjectStatus.ACTIVE);
    expect(statusFor('SUSPENDED', ProjectStatus.ACTIVE)).toBe(
      ProjectStatus.SUSPENDED,
    );
    expect(statusFor('CLOSED', ProjectStatus.ACTIVE)).toBe(
      ProjectStatus.CLOSED,
    );
    // An archived project stays archived while the core keeps it closed.
    expect(statusFor('CLOSED', ProjectStatus.ARCHIVED)).toBe(
      ProjectStatus.ARCHIVED,
    );
    expect(statusFor('ONGOING', ProjectStatus.ARCHIVED)).toBe(
      ProjectStatus.ACTIVE,
    );
    expect(dayOf('2027-06-30T00:00:00.000Z')).toEqual(
      new Date('2027-06-30T00:00:00.000Z'),
    );
  });

  it('creates a copy under the core’s id, with the core’s fields', async () => {
    const tx = makeTx([]);
    const cascades = await apply(tx, [coreProject()]);

    expect(tx.project.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        id: 'p-1',
        companyId: 'co-1',
        reference: 'PRJ-2026-001',
        name: 'Viaduc de la Sanaga',
        description: 'Ouvrage d’art',
        status: ProjectStatus.ACTIVE,
        responsibleId: 'u-1',
        budget: '1500000',
        startDate: new Date('2026-01-01T00:00:00.000Z'),
        endDate: new Date('2027-06-30T00:00:00.000Z'),
        coreSyncedAt: NOW,
      }),
    });
    expect(tx.statusHistory.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        entity: 'Project',
        entityId: 'p-1',
        fromStatus: null,
        toStatus: ProjectStatus.ACTIVE,
        event: 'CORE_CREATE',
        actorId: null,
      }),
    });
    expect(cascades).toEqual([]);
  });

  it('leaves the responsible empty when the leader is not one of the company’s people', async () => {
    const tx = makeTx([]);
    await apply(tx, [coreProject({ leaderId: 'u-elsewhere' })]);
    expect(tx.project.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ responsibleId: null }),
    });
  });

  it('keeps Diffusion’s own fields on update and closes with the core', async () => {
    const tx = makeTx([row()]);
    const cascades = await apply(tx, [coreProject({ status: 'CLOSED' })]);

    const data = (
      tx.project.update.mock.calls[0][0] as { data: Record<string, unknown> }
    ).data;
    expect(data).toMatchObject({
      status: ProjectStatus.CLOSED,
      closedAt: NOW,
      coreSyncedAt: NOW,
    });
    for (const own of ['contentType', 'mode', 'maitreOuvrageId', 'companyId'])
      expect(data).not.toHaveProperty(own);
    expect(cascades).toEqual([
      expect.objectContaining({
        projectId: 'p-1',
        from: ProjectStatus.ACTIVE,
        to: ProjectStatus.CLOSED,
        newClosedAt: NOW,
      }),
    ]);
  });

  it('suspends without consequences on the contents', async () => {
    const tx = makeTx([row()]);
    const cascades = await apply(tx, [coreProject({ status: 'SUSPENDED' })]);
    expect(tx.project.update).toHaveBeenCalledWith({
      where: { id: 'p-1' },
      data: expect.objectContaining({ status: ProjectStatus.SUSPENDED }),
    });
    expect(cascades).toHaveLength(1);
    // Nothing to do between ACTIVE and SUSPENDED.
    const transition = jest.fn();
    const workflow = { transition } as unknown as WorkflowService;
    await cascadeOf({} as never, workflow, cascades[0]);
    expect(transition).not.toHaveBeenCalled();
  });

  it('deletes a copy the core no longer lists when nothing refers to it, else closes it', async () => {
    const tx = makeTx(
      [row({ id: 'gone-unused' }), row({ id: 'gone-used', reference: 'X' })],
      { 'gone-used': 2 },
    );
    const cascades = await apply(tx, []);

    expect(tx.project.delete).toHaveBeenCalledWith({
      where: { id: 'gone-unused' },
    });
    expect(tx.project.update).toHaveBeenCalledWith({
      where: { id: 'gone-used' },
      data: { status: ProjectStatus.CLOSED, closedAt: NOW, coreSyncedAt: NOW },
    });
    expect(cascades.map((c) => c.projectId)).toEqual(['gone-used']);
  });

  it('never removes a project made in Diffusion before the core owned them', async () => {
    const tx = makeTx([row({ id: 'legacy', coreSyncedAt: null })]);
    await apply(tx, []);
    expect(tx.project.delete).not.toHaveBeenCalled();
    expect(tx.project.update).not.toHaveBeenCalled();
  });

  it('gives the core’s id to the Diffusion project with the same reference', async () => {
    const tx = makeTx([
      row({ id: 'legacy', reference: 'prj-2026-001 ', coreSyncedAt: null }),
    ]);
    await apply(tx, [coreProject({ id: 'core-1' })]);

    expect(tx.$executeRaw).toHaveBeenCalledTimes(3);
    expect(tx.project.create).not.toHaveBeenCalled();
    expect(tx.project.update).toHaveBeenCalledWith({
      where: { id: 'core-1' },
      data: expect.objectContaining({ reference: 'PRJ-2026-001' }),
    });
  });

  describe('consequences on the contents (as Diffusion’s own closing did)', () => {
    const change = (over: Partial<ProjectCascade>): ProjectCascade => ({
      projectId: 'p-1',
      companyId: 'co-1',
      from: ProjectStatus.ACTIVE,
      to: ProjectStatus.CLOSED,
      closedAt: null,
      archivedAt: null,
      newClosedAt: NOW,
      ...over,
    });
    const tx = () => ({
      instruction: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: 'i-1',
            status: 'EN_COURS',
            statusBeforeProjectClosure: 'EN_COURS',
          },
        ]),
      },
      courrier: { findMany: jest.fn().mockResolvedValue([]) },
      dossier: { findMany: jest.fn().mockResolvedValue([]) },
      contract: { findMany: jest.fn().mockResolvedValue([]) },
      analysisSheet: { findMany: jest.fn().mockResolvedValue([]) },
    });

    it('closing cancels the open tasks as a system change', async () => {
      const transition = jest.fn();
      const workflow = { transition } as unknown as WorkflowService;
      await cascadeOf(tx() as never, workflow, change({}));
      expect(transition).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          entityId: 'i-1',
          event: 'CANCEL_BY_PROJECT',
          system: true,
          companyId: 'co-1',
        }),
      );
    });

    it('reopening gives the tasks back what they were', async () => {
      const transition = jest.fn();
      const workflow = { transition } as unknown as WorkflowService;
      await cascadeOf(
        tx() as never,
        workflow,
        change({
          from: ProjectStatus.CLOSED,
          to: ProjectStatus.ACTIVE,
          closedAt: NOW,
          newClosedAt: null,
        }),
      );
      expect(transition).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          entityId: 'i-1',
          event: 'REOPEN_BY_PROJECT',
          to: 'EN_COURS',
        }),
      );
    });
  });
});
