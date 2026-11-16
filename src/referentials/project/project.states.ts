import { ProjectStatus } from '../../../generated/prisma/client';
import { Permission } from '../../auth/permissions';
import { TransitionTable } from '../../workflow/transition-table';

const S = ProjectStatus;

/**
 * Events on Project.status (PATCH /projects/:id {status}), replacing NEXT_STATUSES: one step at
 * a time, ACTIVE ⇄ CLOSED ⇄ ARCHIVED. Each change cascades to the project's contents
 * (project-cascade.ts).
 */
export type ProjectEvent = 'CLOSE' | 'REOPEN' | 'ARCHIVE' | 'UNARCHIVE';

export const PROJECT_STATES = new TransitionTable<ProjectStatus, ProjectEvent>(
  'Project',
  'status',
  [
    {
      from: S.ACTIVE,
      event: 'CLOSE',
      to: S.CLOSED,
      permission: Permission.PROJECT_UPDATE,
    },
    {
      from: S.CLOSED,
      event: 'REOPEN',
      to: S.ACTIVE,
      permission: Permission.PROJECT_UPDATE,
    },
    {
      from: S.CLOSED,
      event: 'ARCHIVE',
      to: S.ARCHIVED,
      permission: Permission.PROJECT_ARCHIVE,
    },
    {
      from: S.ARCHIVED,
      event: 'UNARCHIVE',
      to: S.CLOSED,
      permission: Permission.PROJECT_ARCHIVE,
    },
  ],
);

/** The event that moves a project from `from` to `to`, if one does. */
export function projectEventFor(
  from: ProjectStatus,
  to: ProjectStatus,
): ProjectEvent | undefined {
  return PROJECT_STATES.all.find(
    (rule) =>
      rule.to === to &&
      (typeof rule.from === 'string'
        ? rule.from === from
        : rule.from.includes(from)),
  )?.event;
}
