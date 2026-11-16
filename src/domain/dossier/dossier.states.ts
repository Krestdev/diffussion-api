import { DossierStatus } from '../../generated/prisma/client';
import { Permission } from '../../auth/permissions';
import { TransitionTable } from '../../workflow/transition-table';

const S = DossierStatus;

/**
 * Events on Dossier.status, as Diffusion does them today (owner 2026-11-15). MARK_IN_PROGRESS
 * (first courrier or instruction attached), MARK_LATE (DossierLatenessService) and the
 * `*_BY_PROJECT` cascade are system changes, without permission.
 */
export type DossierEvent =
  | 'MARK_IN_PROGRESS'
  | 'MARK_LATE'
  | 'DUE_DATE_CHANGED'
  | 'CLOSE'
  | 'REOPEN'
  | 'ARCHIVE'
  | 'UNARCHIVE'
  | 'CLOSE_BY_PROJECT'
  | 'REOPEN_BY_PROJECT'
  | 'ARCHIVE_BY_PROJECT'
  | 'RESTORE_BY_PROJECT';

/** Still worked on (dossier-lifecycle.ts ACTIVE_DOSSIER_STATUSES). */
const ACTIVE: readonly DossierStatus[] = [
  S.OPEN,
  S.IN_PROGRESS,
  S.PENDING,
  S.LATE,
];

export const DOSSIER_STATES = new TransitionTable<DossierStatus, DossierEvent>(
  'Dossier',
  'status',
  [
    { from: S.OPEN, event: 'MARK_IN_PROGRESS', to: S.IN_PROGRESS },
    {
      from: [S.OPEN, S.IN_PROGRESS, S.PENDING],
      event: 'MARK_LATE',
      to: S.LATE,
    },
    // Its due date moved (statusForDueDate): LATE once overdue, IN_PROGRESS when pushed back.
    {
      from: ACTIVE,
      event: 'DUE_DATE_CHANGED',
      to: [S.LATE, S.IN_PROGRESS],
      permission: Permission.DOSSIER_UPDATE,
    },
    {
      from: ACTIVE,
      event: 'CLOSE',
      to: S.CLOSED,
      permission: Permission.DOSSIER_CLOSE,
    },
    // statusForDueDate(IN_PROGRESS): LATE when already overdue.
    {
      from: S.CLOSED,
      event: 'REOPEN',
      to: [S.IN_PROGRESS, S.LATE],
      permission: Permission.DOSSIER_REOPEN,
    },
    {
      from: S.CLOSED,
      event: 'ARCHIVE',
      to: S.ARCHIVED,
      permission: Permission.DOSSIER_ARCHIVE,
    },
    {
      from: S.ARCHIVED,
      event: 'UNARCHIVE',
      to: S.CLOSED,
      permission: Permission.DOSSIER_ARCHIVE,
    },
    { from: ACTIVE, event: 'CLOSE_BY_PROJECT', to: S.CLOSED },
    {
      from: S.CLOSED,
      event: 'REOPEN_BY_PROJECT',
      to: [S.IN_PROGRESS, S.LATE],
    },
    { from: S.CLOSED, event: 'ARCHIVE_BY_PROJECT', to: S.ARCHIVED },
    { from: S.ARCHIVED, event: 'RESTORE_BY_PROJECT', to: S.CLOSED },
  ],
);
