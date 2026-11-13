import {
  AnalysisSheetStatus,
  LivrableStatus,
  Prisma,
} from '../../generated/prisma/client';

/**
 * A fiche still in progress on its effet — at most one per effet. The others
 * are history: archived, replaced by a later version, or carried by a
 * rejected (or archived) livrable.
 */
export const LIVE_ANALYSIS_SHEET_WHERE = {
  status: { not: AnalysisSheetStatus.ARCHIVEE },
  nextVersion: { is: null },
  OR: [
    { livrableId: null },
    {
      livrable: {
        status: { notIn: [LivrableStatus.REJETE, LivrableStatus.ARCHIVE] },
      },
    },
  ],
} satisfies Prisma.AnalysisSheetWhereInput;
