import {
  AnalysisSheetStatus,
  CourrierStatus,
  LivrableStatus,
} from '../../generated/prisma/client';
import { can } from '../auth/access/permission-checks';
import { Permission } from '../auth/permissions';
import {
  ActionBlockReason,
  ActionState,
  ActionStates,
  blocked,
  needsDesignation,
  needsStatus,
  needsStatusIn,
} from '../workflow/action-states';
import { ANALYSIS_SHEET_STATES } from './analysis-sheet.states';

/** What the UI may draw on a fiche d'analyse (GET /analysis-sheets/:id `actions`). */
export type AnalysisSheetAction =
  | 'edit'
  | 'submit'
  | 'decide'
  | 'sign'
  | 'newVersion'
  | 'archive'
  | 'unarchive'
  | 'delete';

/** A fiche answering an instruction is editable while its livrable is being prepared. */
const EDITABLE_LIVRABLE: readonly LivrableStatus[] = [
  LivrableStatus.EN_PREPARATION,
  LivrableStatus.DEPOSE,
];
const EDITABLE: readonly AnalysisSheetStatus[] = [
  AnalysisSheetStatus.BROUILLON,
  AnalysisSheetStatus.ENREGISTREE,
];
const VERSIONABLE: readonly AnalysisSheetStatus[] = [
  AnalysisSheetStatus.ENREGISTREE,
  AnalysisSheetStatus.SIGNEE,
];
/** No new fiche (nor version) on an effet done with. */
const FROZEN_EFFET: readonly CourrierStatus[] = [
  CourrierStatus.CLOTURE,
  CourrierStatus.ARCHIVE,
  CourrierStatus.ANNULE,
];

export interface ActionsSheet {
  status: AnalysisSheetStatus;
  authorId: string;
  livrable: { status: LivrableStatus } | null;
  nextVersion: { id: string } | null;
  items: { opinion: unknown }[];
}

/**
 * The actions of a fiche for the signed-in person, with the routes' rules: left out without
 * the permission (and, to submit, without being its author); otherwise enabled or disabled with
 * the first reason.
 */
export function analysisSheetActions(
  sheet: ActionsSheet,
  context: { userId: string; effetStatus: CourrierStatus },
): ActionState<AnalysisSheetAction>[] {
  const status = sheet.status;
  const livrableLocked =
    sheet.livrable && !EDITABLE_LIVRABLE.includes(sheet.livrable.status)
      ? blocked(ActionBlockReason.WRONG_STATUS, {
          status: sheet.livrable.status,
        })
      : null;
  const editable = needsStatusIn(status, EDITABLE);
  const noInstruction =
    !sheet.livrable &&
    blocked(ActionBlockReason.PREREQUISITE_MISSING, { missing: 'INSTRUCTION' });
  const unjudged =
    (sheet.items.length === 0 ||
      sheet.items.some((item) => item.opinion === null)) &&
    blocked(ActionBlockReason.PREREQUISITE_MISSING, { missing: 'OPINIONS' });
  const updates = can(Permission.ANALYSIS_UPDATE);
  const archives = can(Permission.ANALYSIS_ARCHIVE);

  return new ActionStates<AnalysisSheetAction>()
    .addIf(updates, 'edit', editable, livrableLocked)
    .addIf(
      updates,
      'submit',
      noInstruction,
      needsDesignation(sheet.authorId === context.userId, 'AUTHOR'),
      needsStatus(ANALYSIS_SHEET_STATES, status, 'SUBMIT'),
      livrableLocked,
      unjudged,
    )
    .addIf(
      can(Permission.ANALYSIS_APPROVE),
      'decide',
      noInstruction,
      sheet.livrable &&
        sheet.livrable.status !== LivrableStatus.SOUMIS &&
        sheet.livrable.status !== LivrableStatus.EN_VALIDATION &&
        blocked(ActionBlockReason.NOTHING_TO_DECIDE),
      unjudged,
    )
    .addIf(
      updates,
      'sign',
      needsStatus(ANALYSIS_SHEET_STATES, status, 'SIGN'),
      livrableLocked,
    )
    .addIf(
      updates,
      'newVersion',
      needsStatusIn(status, VERSIONABLE),
      sheet.nextVersion &&
        blocked(ActionBlockReason.WRONG_STATUS, { status: 'REPLACED' }),
      FROZEN_EFFET.includes(context.effetStatus) &&
        blocked(ActionBlockReason.DOSSIER_CLOSED),
    )
    .addIf(
      archives,
      'archive',
      needsStatus(ANALYSIS_SHEET_STATES, status, 'ARCHIVE'),
    )
    .addIf(
      archives,
      'unarchive',
      needsStatus(ANALYSIS_SHEET_STATES, status, 'UNARCHIVE'),
    )
    .addIf(
      updates,
      'delete',
      needsStatusIn(status, [AnalysisSheetStatus.BROUILLON]),
      livrableLocked,
    ).all;
}
