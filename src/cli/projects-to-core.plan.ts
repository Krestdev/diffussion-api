/**
 * Moving Diffusion's own projects into the CREAPP core (owner, 2026-11-23, as EXPENZO's projects on
 * 2026-11-03), keeping their ids: Diffusion's records point at them and stay untouched. Once a
 * company's projects are in the core, the core owns them (Tenant.projectsSince) and its directory
 * sends them back to Diffusion as read-only copies (src/core/project-sync.ts). projects-to-core.ts
 * reads both databases and applies this plan.
 */

/** A project as Diffusion's "project" table holds it. */
export interface DiffusionProject {
  id: string;
  companyId: string;
  name: string;
  reference: string | null;
  description: string | null;
  /** ACTIVE, SUSPENDED, CLOSED, ARCHIVED. */
  status: string;
  responsibleId: string | null;
  startDate: Date | string | null;
  endDate: Date | string | null;
  budget: string | null;
  createdAt: Date;
  /** Set: already a copy of a core project (nothing to import). */
  coreSyncedAt: Date | null;
}

export interface CoreState {
  /** The core's companies (tenants), with when the core started owning their projects. */
  tenants: { id: string; projectsSince: Date | null; otherApps: string[] }[];
  /** The core's users (a project's leader must be one of its company's). */
  users: { id: string; tenantId: string }[];
  /** The core's projects. */
  projects: { id: string; tenantId: string; reference: string }[];
}

export interface CoreProjectRow {
  id: string;
  tenantId: string;
  reference: string;
  name: string;
  description: string | null;
  status: 'ONGOING' | 'SUSPENDED' | 'CLOSED';
  leaderId: string | null;
  startsOn: Date | null;
  endsOn: Date | null;
  budget: string | null;
  createdAt: Date;
}

export interface ImportPlan {
  projects: CoreProjectRow[];
  /** The companies whose projects the core owns afterwards. */
  tenantIds: string[];
  /** Diffusion projects with the reference of a core project: the next directory sync gives them
   * the core project's id (src/core/project-sync.ts). */
  matched: { id: string; reference: string; coreId: string }[];
  conflicts: string[];
  warnings: string[];
}

/** Diffusion's four statuses on the core's three (an archived project is a closed one). */
export const CORE_STATUS_OF: Record<
  string,
  'ONGOING' | 'SUSPENDED' | 'CLOSED'
> = {
  ACTIVE: 'ONGOING',
  SUSPENDED: 'SUSPENDED',
  CLOSED: 'CLOSED',
  ARCHIVED: 'CLOSED',
};

export function planProjectsToCore(
  projects: DiffusionProject[],
  core: CoreState,
  options: { first?: boolean } = {},
): ImportPlan {
  const conflicts: string[] = [];
  const warnings: string[] = [];
  const matched: ImportPlan['matched'] = [];
  const tenants = new Map(core.tenants.map((t) => [t.id, t]));
  const userTenant = new Map(core.users.map((u) => [u.id, u.tenantId]));
  const coreIds = new Set(core.projects.map((p) => p.id));
  /** References taken per company: the core's, then those planned. */
  const taken = new Map<string, Map<string, string>>();
  const takenIn = (tenantId: string) => {
    let refs = taken.get(tenantId);
    if (!refs) {
      refs = new Map(
        core.projects
          .filter((p) => p.tenantId === tenantId)
          .map((p) => [p.reference.toUpperCase(), p.id]),
      );
      taken.set(tenantId, refs);
    }
    return refs;
  };
  const plan: CoreProjectRow[] = [];
  const later: { project: DiffusionProject; row: CoreProjectRow }[] = [];

  for (const project of projects) {
    const label = project.reference ?? project.name;
    // Already a copy of a core project: nothing to import.
    if (project.coreSyncedAt) continue;
    const tenant = tenants.get(project.companyId);
    if (!tenant) {
      warnings.push(`${label}: its company is not in the core (skipped)`);
      continue;
    }
    if (
      !tenant.projectsSince &&
      tenant.otherApps.length > 0 &&
      !options.first
    ) {
      conflicts.push(
        `${label}: the core doesn't own the projects of its company yet and the company also uses ${tenant.otherApps.join(', ')} — run the core's import for those apps first (EXPENZO: npm run import:projects in creapp-core-api), or pass --first`,
      );
      continue;
    }
    const status = CORE_STATUS_OF[project.status];
    if (!status) {
      conflicts.push(`${label}: unknown status ${project.status}`);
      continue;
    }
    let leaderId = project.responsibleId;
    if (leaderId && userTenant.get(leaderId) !== project.companyId) {
      warnings.push(
        `${label}: its responsible is not a user of the company in the core (left empty)`,
      );
      leaderId = null;
    }
    if (!leaderId) warnings.push(`${label}: no project leader`);
    const startsOn = dayOf(project.startDate);
    let endsOn = dayOf(project.endDate);
    if (startsOn && endsOn && endsOn < startsOn) {
      warnings.push(`${label}: its end is before its start (end left empty)`);
      endsOn = null;
    }
    const row: CoreProjectRow = {
      id: project.id,
      tenantId: project.companyId,
      reference: '',
      name: project.name.trim().slice(0, 128),
      description: project.description,
      status,
      leaderId,
      startsOn,
      endsOn,
      budget:
        project.budget && Number(project.budget) !== 0 ? project.budget : null,
      createdAt: project.createdAt,
    };
    const refs = takenIn(project.companyId);
    const reference = project.reference?.trim().toUpperCase();
    if (!reference) {
      later.push({ project, row });
      continue;
    }
    const holder = refs.get(reference);
    if (holder && holder !== project.id) {
      if (coreIds.has(holder) && !plan.some((p) => p.id === holder)) {
        // The same project at the core (e.g. imported from EXPENZO): Diffusion's copy takes its id.
        matched.push({ id: project.id, reference, coreId: holder });
        continue;
      }
      conflicts.push(
        `${reference}: used by two Diffusion projects of the same company`,
      );
      continue;
    }
    refs.set(reference, project.id);
    plan.push({ ...row, reference });
  }

  // Projects without a reference get the core's next free one (PRJ-<year created>-NNN).
  for (const { project, row } of later) {
    const refs = takenIn(project.companyId);
    const reference = freeReference(refs, project.createdAt.getUTCFullYear());
    refs.set(reference, project.id);
    warnings.push(`${project.name}: no reference, ${reference} given`);
    plan.push({ ...row, reference });
  }

  return {
    projects: plan,
    tenantIds: [...new Set(plan.map((p) => p.tenantId))],
    matched,
    conflicts: [...new Set(conflicts)],
    warnings,
  };
}

/** PRJ-<year>-NNN after the highest number of that year among the references taken. */
export function freeReference(refs: Map<string, string>, year: number): string {
  const prefix = `PRJ-${year}-`;
  let highest = 0;
  for (const reference of refs.keys()) {
    if (!reference.startsWith(prefix)) continue;
    const n = Number(reference.slice(prefix.length));
    if (Number.isInteger(n) && n > highest) highest = n;
  }
  for (let n = highest + 1; ; n += 1) {
    const reference = `${prefix}${String(n).padStart(3, '0')}`;
    if (!refs.has(reference)) return reference;
  }
}

/** A date (or "2026-12-01…") as that day at 00:00 UTC. */
function dayOf(value: string | Date | null | undefined): Date | null {
  if (!value) return null;
  const text = value instanceof Date ? value.toISOString() : value;
  const day = /^(\d{4}-\d{2}-\d{2})/.exec(text)?.[1];
  return day ? new Date(`${day}T00:00:00.000Z`) : null;
}
