import { LivrableStatus } from '../../../generated/prisma/client';
import { TransitionTable } from '../../workflow/transition-table';

const S = LivrableStatus;

/**
 * Events on Livrable.status, as Diffusion does them today (owner 2026-11-15). A new version is a
 * new livrable (recorded with `record`, event NEW_VERSION), the old one only loses isLatest. The
 * validateur's opinion (AVIS) moves validationStep, not the status. Who may act (subscriber,
 * decider, validateur, deliverable.create…) is checked by the services.
 */
export type LivrableEvent = 'DEPOSIT' | 'SUBMIT' | 'APPROVE' | 'REJECT';

export const LIVRABLE_STATES = new TransitionTable<
  LivrableStatus,
  LivrableEvent
>('Livrable', 'status', [
  { from: S.EN_PREPARATION, event: 'DEPOSIT', to: S.DEPOSE },
  // POST /deliverables/:id/submit (DEPOSE), POST /instructions/:id/livrables/deposer and a
  // fiche d'analyse submitted (EN_PREPARATION or DEPOSE).
  { from: [S.EN_PREPARATION, S.DEPOSE], event: 'SUBMIT', to: S.SOUMIS },
  // The decider's decision (EN_VALIDATION: a fiche d'analyse decided).
  { from: [S.SOUMIS, S.EN_VALIDATION], event: 'APPROVE', to: S.VALIDE },
  { from: [S.SOUMIS, S.EN_VALIDATION], event: 'REJECT', to: S.REJETE },
]);
