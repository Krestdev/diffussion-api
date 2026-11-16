import {
  CoreState,
  DiffusionProject,
  freeReference,
  planProjectsToCore,
} from './projects-to-core.plan';

const project = (over: Partial<DiffusionProject> = {}): DiffusionProject => ({
  id: 'p-1',
  companyId: 't-1',
  name: 'Viaduc de la Sanaga',
  reference: 'prj-2026-007',
  description: null,
  status: 'ACTIVE',
  responsibleId: 'u-1',
  startDate: new Date('2026-01-01T00:00:00.000Z'),
  endDate: '2027-06-30',
  budget: null,
  createdAt: new Date('2026-01-01T00:00:00.000Z'),
  coreSyncedAt: null,
  ...over,
});

const core = (over: Partial<CoreState> = {}): CoreState => ({
  tenants: [{ id: 't-1', projectsSince: null, otherApps: [] }],
  users: [{ id: 'u-1', tenantId: 't-1' }],
  projects: [],
  ...over,
});

describe('projects-to-core plan', () => {
  it('imports a project under its id, with the core’s status and its responsible as leader', () => {
    const plan = planProjectsToCore([project()], core());
    expect(plan.conflicts).toEqual([]);
    expect(plan.projects).toEqual([
      expect.objectContaining({
        id: 'p-1',
        tenantId: 't-1',
        reference: 'PRJ-2026-007',
        status: 'ONGOING',
        leaderId: 'u-1',
        startsOn: new Date('2026-01-01T00:00:00.000Z'),
        endsOn: new Date('2027-06-30T00:00:00.000Z'),
      }),
    ]);
    expect(plan.tenantIds).toEqual(['t-1']);
  });

  it('maps archived and closed projects to CLOSED', () => {
    const plan = planProjectsToCore(
      [
        project({ id: 'a', reference: 'A', status: 'ARCHIVED' }),
        project({ id: 'b', reference: 'B', status: 'CLOSED' }),
      ],
      core(),
    );
    expect(plan.projects.map((p) => p.status)).toEqual(['CLOSED', 'CLOSED']);
  });

  it('skips copies already synced from the core', () => {
    const plan = planProjectsToCore(
      [project({ coreSyncedAt: new Date() })],
      core(),
    );
    expect(plan.projects).toEqual([]);
  });

  it('matches a project whose reference the core already has (e.g. from EXPENZO)', () => {
    const plan = planProjectsToCore(
      [project()],
      core({
        tenants: [{ id: 't-1', projectsSince: new Date(), otherApps: [] }],
        projects: [
          { id: 'core-7', tenantId: 't-1', reference: 'PRJ-2026-007' },
        ],
      }),
    );
    expect(plan.projects).toEqual([]);
    expect(plan.matched).toEqual([
      { id: 'p-1', reference: 'PRJ-2026-007', coreId: 'core-7' },
    ]);
  });

  it('gives a reference to a project without one', () => {
    const plan = planProjectsToCore(
      [project({ reference: null })],
      core({
        projects: [{ id: 'x', tenantId: 't-1', reference: 'PRJ-2026-004' }],
      }),
    );
    expect(plan.projects[0].reference).toBe('PRJ-2026-005');
    expect(plan.warnings).toContain(
      'Viaduc de la Sanaga: no reference, PRJ-2026-005 given',
    );
  });

  it('refuses two Diffusion projects with the same reference', () => {
    const plan = planProjectsToCore(
      [project(), project({ id: 'p-2' })],
      core(),
    );
    expect(plan.conflicts).toHaveLength(1);
  });

  it('refuses a company that also uses another app while the core doesn’t own its projects', () => {
    const tenants = [{ id: 't-1', projectsSince: null, otherApps: ['besoin'] }];
    expect(
      planProjectsToCore([project()], core({ tenants })).conflicts,
    ).toHaveLength(1);
    expect(
      planProjectsToCore([project()], core({ tenants }), { first: true })
        .conflicts,
    ).toEqual([]);
  });

  it('leaves the leader empty when the responsible is not a core user of the company', () => {
    const plan = planProjectsToCore(
      [project({ responsibleId: 'u-x' })],
      core(),
    );
    expect(plan.projects[0].leaderId).toBeNull();
  });

  it('finds the next free reference of a year', () => {
    const refs = new Map([
      ['PRJ-2026-001', 'a'],
      ['PRJ-2026-003', 'b'],
      ['PRJ-2025-009', 'c'],
    ]);
    expect(freeReference(refs, 2026)).toBe('PRJ-2026-004');
    expect(freeReference(refs, 2024)).toBe('PRJ-2024-001');
  });
});
