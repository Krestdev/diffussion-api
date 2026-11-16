import { Logger } from '@nestjs/common';
import { Prisma, ProjectStatus } from '../generated/prisma/client';
import { cascadeProjectStatus } from '../referentials/project/project-cascade';
import { WorkflowService } from '../workflow/workflow.service';
import type { CoreProject } from './core-client';

type Tx = Prisma.TransactionClient;

/**
 * Projects come from the CREAPP core (owner, 2026-11-23, as EXPENZO): the core owns them, its
 * directory sends a company's projects once it does (Tenant.projectsSince), and Diffusion keeps
 * read-only copies under the same ids. The core's fields are written here only; Diffusion's own
 * (contentType, mode, maître d'ouvrage, who may open it) are left as they are.
 *
 * Statuses: ONGOING -> ACTIVE, SUSPENDED -> SUSPENDED (still offered, marked), CLOSED -> CLOSED
 * (an ARCHIVED project, from before, stays archived while the core keeps it closed). A change of
 * status does to the project's contents what Diffusion's own closing / reopening did
 * (project-cascade.ts), after the directory is applied (ProjectCascade, runProjectCascades).
 *
 * Removal: a copy the core no longer lists (deleted there, so cited by no effet) is deleted when
 * nothing of Diffusion's refers to it, else closed. Projects made in Diffusion before the core
 * owned them (coreSyncedAt null) are never removed: a core project with the same reference in the
 * same company takes them over (its id replaces theirs), the others wait for
 * `npm run projects:to-core`.
 */

/** The core's three statuses on Diffusion's. */
export const STATUS_OF: Record<string, ProjectStatus> = {
  ONGOING: ProjectStatus.ACTIVE,
  SUSPENDED: ProjectStatus.SUSPENDED,
  CLOSED: ProjectStatus.CLOSED,
};

/** Diffusion's status for the core's, given the copy's current one. */
export function statusFor(
  core: string,
  current: ProjectStatus | undefined,
): ProjectStatus {
  const target = STATUS_OF[core] ?? ProjectStatus.ACTIVE;
  if (target === ProjectStatus.CLOSED && current === ProjectStatus.ARCHIVED) {
    return ProjectStatus.ARCHIVED;
  }
  return target;
}

const OPEN: ProjectStatus[] = [ProjectStatus.ACTIVE, ProjectStatus.SUSPENDED];
const isOpen = (status: ProjectStatus) => OPEN.includes(status);

/** A change of status whose consequences on the contents run after the directory is applied. */
export interface ProjectCascade {
  projectId: string;
  companyId: string;
  from: ProjectStatus;
  to: ProjectStatus;
  /** The copy's dates before the change (what the closing or archiving did is found by them). */
  closedAt: Date | null;
  archivedAt: Date | null;
  /** The closing date stamped now (closing only). */
  newClosedAt: Date | null;
}

/** The stamps a change of status writes on the copy. */
function stampsOf(
  from: ProjectStatus | undefined,
  to: ProjectStatus,
  now: Date,
): Prisma.ProjectUncheckedUpdateInput {
  if (from === undefined || from === to) return {};
  if (to === ProjectStatus.CLOSED) {
    return from === ProjectStatus.ARCHIVED ? {} : { closedAt: now };
  }
  if (isOpen(to) && isOpen(from)) return {};
  // Open again: neither closed nor archived any more.
  return { closedAt: null, archivedAt: null, archiveReason: null };
}

/** "2026-12-01" or an ISO timestamp, as that day at 00:00 UTC. */
export function dayOf(value: string | null | undefined): Date | null {
  if (!value) return null;
  const day = /^(\d{4}-\d{2}-\d{2})/.exec(value)?.[1];
  return day ? new Date(`${day}T00:00:00.000Z`) : null;
}

/** Whether anything of Diffusion's refers to the project. */
async function inUse(tx: Tx, projectId: string): Promise<boolean> {
  const counts = await tx.project.findUnique({
    where: { id: projectId },
    select: {
      _count: {
        select: {
          dossiers: true,
          contracts: true,
          courriers: true,
          analysisSheets: true,
        },
      },
    },
  });
  if (!counts) return false;
  const c = counts._count;
  return c.dossiers + c.contracts + c.courriers + c.analysisSheets > 0;
}

/**
 * Applies the core's projects of one company (inside the directory's transaction). Returns the
 * changes of status whose cascades remain to run.
 */
export async function applyProjects(
  tx: Tx,
  companyId: string,
  projects: CoreProject[],
  people: Set<string>,
  now: Date,
  logger?: Logger,
): Promise<ProjectCascade[]> {
  const cascades: ProjectCascade[] = [];
  const listed = new Set(projects.map((p) => p.id));
  const existing = await tx.project.findMany({
    where: { companyId },
    select: {
      id: true,
      reference: true,
      status: true,
      closedAt: true,
      archivedAt: true,
      coreSyncedAt: true,
    },
  });
  const byId = new Map(existing.map((p) => [p.id, p]));

  // A project made in Diffusion before the core owned them, with the reference of a core project
  // Diffusion doesn't know yet: the same project; it takes the core's id (every foreign key to
  // "project" cascades on update; the journals keep plain ids).
  const legacy = existing.filter((p) => !p.coreSyncedAt && !listed.has(p.id));
  for (const project of projects) {
    if (byId.has(project.id)) continue;
    const reference = project.reference.trim().toUpperCase();
    const matches = legacy.filter(
      (p) => p.reference?.trim().toUpperCase() === reference,
    );
    if (matches.length !== 1) {
      if (matches.length > 1) {
        logger?.warn(
          `company ${companyId}: several Diffusion projects have the reference ${reference}: none matched to the core's project ${project.id}`,
        );
      }
      continue;
    }
    const match = matches[0];
    await tx.$executeRaw`UPDATE "project" SET "id" = ${project.id} WHERE "id" = ${match.id}`;
    await tx.$executeRaw`UPDATE "activity_log" SET "entityId" = ${project.id} WHERE "entityType" = 'project' AND "entityId" = ${match.id}`;
    await tx.$executeRaw`UPDATE "status_history" SET "entityId" = ${project.id} WHERE "entity" = 'Project' AND "entityId" = ${match.id}`;
    logger?.log(
      `project ${match.id} (${reference}) matched to the core's project ${project.id}`,
    );
    legacy.splice(legacy.indexOf(match), 1);
    byId.set(project.id, { ...match, id: project.id });
  }

  // Copies the core no longer lists: deleted when unused, else closed. Projects made in Diffusion
  // before (never synced) are kept as they are.
  for (const row of existing) {
    if (listed.has(row.id) || !row.coreSyncedAt) continue;
    if (!(await inUse(tx, row.id))) {
      await tx.project.delete({ where: { id: row.id } });
      continue;
    }
    if (!isOpen(row.status)) continue;
    await tx.project.update({
      where: { id: row.id },
      data: { status: ProjectStatus.CLOSED, closedAt: now, coreSyncedAt: now },
    });
    await history(tx, companyId, row.id, row.status, ProjectStatus.CLOSED);
    cascades.push({
      projectId: row.id,
      companyId,
      from: row.status,
      to: ProjectStatus.CLOSED,
      closedAt: row.closedAt,
      archivedAt: row.archivedAt,
      newClosedAt: now,
    });
  }
  if (legacy.length > 0) {
    logger?.warn(
      `company ${companyId}: ${legacy.length} project(s) made in Diffusion are not in the core yet (run npm run projects:to-core)`,
    );
  }

  for (const project of projects) {
    const current = byId.get(project.id);
    const status = statusFor(project.status, current?.status);
    const startDate = dayOf(project.startsOn);
    let endDate = dayOf(project.endsOn);
    if (startDate && endDate && endDate < startDate) endDate = null;
    const data = {
      reference: project.reference.slice(0, 50),
      name: project.name,
      description: project.description,
      status,
      responsibleId:
        project.leaderId && people.has(project.leaderId)
          ? project.leaderId
          : null,
      budget: project.budget,
      startDate,
      endDate,
      coreSyncedAt: now,
    };
    if (!current) {
      await tx.project.create({
        data: {
          id: project.id,
          companyId,
          ...data,
          ...(status === ProjectStatus.CLOSED ? { closedAt: now } : {}),
        },
      });
      await history(tx, companyId, project.id, null, status);
      continue;
    }
    await tx.project.update({
      where: { id: project.id },
      data: { ...data, ...stampsOf(current.status, status, now) },
    });
    if (current.status === status) continue;
    await history(tx, companyId, project.id, current.status, status);
    cascades.push({
      projectId: project.id,
      companyId,
      from: current.status,
      to: status,
      closedAt: current.closedAt,
      archivedAt: current.archivedAt,
      newClosedAt: status === ProjectStatus.CLOSED ? now : null,
    });
  }
  return cascades;
}

/** The copy's change of status, as the core's (no actor: the system's). */
async function history(
  tx: Tx,
  companyId: string,
  projectId: string,
  from: ProjectStatus | null,
  to: ProjectStatus,
) {
  await tx.statusHistory.create({
    data: {
      companyId,
      entity: 'Project',
      entityId: projectId,
      field: 'status',
      fromStatus: from,
      toStatus: to,
      event: from === null ? 'CORE_CREATE' : 'CORE_SYNC',
      actorId: null,
      reason: 'CREAPP',
      ip: null,
    },
  });
}

/**
 * What a change of status does to the project's contents, as Diffusion's own closing and
 * reopening did: closing closes or cancels what is still open; opening again (from closed, or
 * from archived) undoes what the closing (and the archiving) did. Between ACTIVE and SUSPENDED
 * nothing changes.
 */
export async function cascadeOf(
  tx: Tx,
  workflow: WorkflowService,
  change: ProjectCascade,
): Promise<void> {
  const project = {
    id: change.projectId,
    companyId: change.companyId,
    closedAt: change.closedAt,
    archivedAt: change.archivedAt,
  };
  if (change.to === ProjectStatus.CLOSED && isOpen(change.from)) {
    await cascadeProjectStatus(
      tx,
      workflow,
      { ...project, status: ProjectStatus.ACTIVE },
      ProjectStatus.CLOSED,
      { closedAt: change.newClosedAt },
    );
    return;
  }
  if (!isOpen(change.to) || isOpen(change.from)) return;
  if (change.from === ProjectStatus.ARCHIVED) {
    await cascadeProjectStatus(
      tx,
      workflow,
      { ...project, status: ProjectStatus.ARCHIVED },
      ProjectStatus.CLOSED,
      {},
    );
  }
  await cascadeProjectStatus(
    tx,
    workflow,
    { ...project, status: ProjectStatus.CLOSED },
    ProjectStatus.ACTIVE,
    {},
  );
}
