import { AnalysisSheetStatus } from '../generated/prisma/client';
import { Permission } from '../auth/permissions';
import { TransitionTable } from '../workflow/transition-table';

const S = AnalysisSheetStatus;

/**
 * Events on AnalysisSheet.status, as Diffusion does them today (owner 2026-11-15). Deciding a
 * fiche moves its livrable and instruction, not the fiche (it stays ENREGISTREE); a new version
 * is a new fiche (recorded with `record`, event NEW_VERSION).
 */
export type AnalysisSheetEvent =
  | 'SUBMIT'
  | 'SIGN'
  | 'ARCHIVE'
  | 'UNARCHIVE'
  | 'ARCHIVE_BY_PROJECT'
  | 'RESTORE_BY_PROJECT';

const LIVE: readonly AnalysisSheetStatus[] = [
  S.BROUILLON,
  S.ENREGISTREE,
  S.SIGNEE,
];

export const ANALYSIS_SHEET_STATES = new TransitionTable<
  AnalysisSheetStatus,
  AnalysisSheetEvent
>('AnalysisSheet', 'status', [
  {
    from: [S.BROUILLON, S.ENREGISTREE],
    event: 'SUBMIT',
    to: S.ENREGISTREE,
    permission: Permission.ANALYSIS_UPDATE,
  },
  {
    from: [S.BROUILLON, S.ENREGISTREE],
    event: 'SIGN',
    to: S.SIGNEE,
    permission: Permission.ANALYSIS_UPDATE,
  },
  {
    from: LIVE,
    event: 'ARCHIVE',
    to: S.ARCHIVEE,
    permission: Permission.ANALYSIS_ARCHIVE,
  },
  // Back to the status it was archived from (ENREGISTREE when unknown).
  {
    from: S.ARCHIVEE,
    event: 'UNARCHIVE',
    to: LIVE,
    permission: Permission.ANALYSIS_ARCHIVE,
  },
  { from: LIVE, event: 'ARCHIVE_BY_PROJECT', to: S.ARCHIVEE },
  { from: S.ARCHIVEE, event: 'RESTORE_BY_PROJECT', to: LIVE },
]);
