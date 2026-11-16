import {
  CourrierDirection,
  CourrierStatus,
} from '../../generated/prisma/client';
import { Permission } from '../../auth/permissions';
import { TransitionTable } from '../../workflow/transition-table';

const S = CourrierStatus;

/**
 * Events on Courrier.status, as Diffusion does them today (owner 2026-11-15: today's behaviour
 * first). The `*_BY_PROJECT` events are the project cascade (project-cascade.ts), AUTO_ARCHIVE
 * the scheduled archiving (auto-archive.service.ts): system changes, no permission.
 */
export type CourrierEvent =
  // Entrants
  | 'TRANSMIT'
  | 'DISPATCH'
  | 'PROPOSE_DISPATCH'
  | 'VALIDATE_DISPATCH'
  | 'REJECT_DISPATCH'
  | 'START_TREATMENT'
  | 'CLOSE'
  // Sortants
  | 'SIGN'
  | 'SEND'
  | 'DISCHARGE'
  // Both
  | 'SUBMIT_FOR_VALIDATION'
  | 'VALIDATE'
  | 'REQUEST_CORRECTIONS'
  | 'CANCEL'
  | 'ARCHIVE'
  | 'UNARCHIVE'
  | 'AUTO_ARCHIVE'
  | 'CLOSE_BY_PROJECT'
  | 'CANCEL_BY_PROJECT'
  | 'REOPEN_BY_PROJECT'
  | 'ARCHIVE_BY_PROJECT'
  | 'RESTORE_BY_PROJECT';

const ALL: readonly CourrierStatus[] = Object.values(CourrierStatus);
const ALL_BUT_ARCHIVE = ALL.filter((status) => status !== S.ARCHIVE);

/** A courrier in one of these is done with (project-cascade.ts COURRIER_DONE). */
export const COURRIER_DONE: readonly CourrierStatus[] = [
  S.CLOTURE,
  S.ARCHIVE,
  S.ANNULE,
  S.ENVOYE,
  S.DECHARGE,
];
const NOT_DONE = ALL.filter((status) => !COURRIER_DONE.includes(status));

/** An entrant still being treated: cancellable, closable (mail.service ENTRANT_OPEN_STATUSES). */
const ENTRANT_OPEN: readonly CourrierStatus[] = [
  S.RECU,
  S.ENREGISTRE,
  S.AFFECTE,
  S.TRANSMIS,
  S.EN_TRAITEMENT,
];

export const COURRIER_ENTRANT_STATES = new TransitionTable<
  CourrierStatus,
  CourrierEvent
>('Courrier', 'status', [
  // Legacy hand-over to the designated responsible (POST /:id/transmit, create/PATCH transmit).
  {
    from: [S.RECU, S.ENREGISTRE, S.AFFECTE],
    event: 'TRANSMIT',
    to: S.TRANSMIS,
  },
  // Dispatched by someone allowed to (canDispatch); re-dispatching keeps it TRANSMIS.
  {
    from: [
      S.RECU,
      S.ENREGISTRE,
      S.EN_ATTENTE_TRANSMISSION,
      S.AFFECTE,
      S.TRANSMIS,
    ],
    event: 'DISPATCH',
    to: S.TRANSMIS,
    permission: Permission.INCOMING_READ,
  },
  // Proposed by someone who may not dispatch: waits for the Dispatching corridor.
  {
    from: [S.RECU, S.ENREGISTRE],
    event: 'PROPOSE_DISPATCH',
    to: S.EN_ATTENTE_TRANSMISSION,
    permission: Permission.INCOMING_READ,
  },
  // No permission on the rule: POST /:id/validate reaches it too (canValidateDispatch).
  {
    from: S.EN_ATTENTE_TRANSMISSION,
    event: 'VALIDATE_DISPATCH',
    to: S.TRANSMIS,
  },
  // « Rejeter le dispatching » (owner 2026-11-15): back to the reception, proposal cleared.
  {
    from: S.EN_ATTENTE_TRANSMISSION,
    event: 'REJECT_DISPATCH',
    to: S.RECU,
    permission: Permission.INCOMING_DISPATCH_VALIDATE,
  },
  // Its first executant subscribed to an instruction (instructions.service subscribe).
  { from: S.TRANSMIS, event: 'START_TREATMENT', to: S.EN_TRAITEMENT },
  {
    from: [S.TRANSMIS, S.EN_TRAITEMENT, S.A_CORRIGER],
    event: 'SUBMIT_FOR_VALIDATION',
    to: S.EN_ATTENTE_VALIDATION,
    permission: Permission.OUTGOING_UPDATE,
  },
  { from: S.EN_ATTENTE_VALIDATION, event: 'VALIDATE', to: S.VALIDE },
  {
    from: S.EN_ATTENTE_VALIDATION,
    event: 'REQUEST_CORRECTIONS',
    to: S.A_CORRIGER,
  },
  {
    from: [...ENTRANT_OPEN, S.VALIDE],
    event: 'CLOSE',
    to: S.CLOTURE,
    permission: Permission.INCOMING_READ,
  },
  // Today's cancel() accepts the open statuses of both directions: an entrant sent for
  // validation (EN_ATTENTE_VALIDATION, A_CORRIGER) can be cancelled too.
  {
    from: [
      ...ENTRANT_OPEN,
      S.EN_ATTENTE_TRANSMISSION,
      S.EN_ATTENTE_VALIDATION,
      S.A_CORRIGER,
    ],
    event: 'CANCEL',
    to: S.ANNULE,
  },
  { from: S.CLOTURE, event: 'ARCHIVE', to: S.ARCHIVE },
  // Back to the status it was archived from (CLOTURE when unknown).
  { from: S.ARCHIVE, event: 'UNARCHIVE', to: ALL_BUT_ARCHIVE },
  { from: [S.CLOTURE, S.ANNULE], event: 'AUTO_ARCHIVE', to: S.ARCHIVE },
  { from: NOT_DONE, event: 'CLOSE_BY_PROJECT', to: S.CLOTURE },
  // Back to its statusBeforeProjectClosure, whatever it became since (today's cascade).
  { from: ALL, event: 'REOPEN_BY_PROJECT', to: ALL },
  { from: ALL_BUT_ARCHIVE, event: 'ARCHIVE_BY_PROJECT', to: S.ARCHIVE },
  { from: S.ARCHIVE, event: 'RESTORE_BY_PROJECT', to: ALL_BUT_ARCHIVE },
]);

export const COURRIER_SORTANT_STATES = new TransitionTable<
  CourrierStatus,
  CourrierEvent
>('Courrier', 'status', [
  {
    from: [S.BROUILLON, S.A_CORRIGER],
    event: 'SUBMIT_FOR_VALIDATION',
    to: S.EN_ATTENTE_VALIDATION,
    permission: Permission.OUTGOING_UPDATE,
  },
  { from: S.EN_ATTENTE_VALIDATION, event: 'VALIDATE', to: S.VALIDE },
  {
    from: S.EN_ATTENTE_VALIDATION,
    event: 'REQUEST_CORRECTIONS',
    to: S.A_CORRIGER,
  },
  {
    from: S.VALIDE,
    event: 'SIGN',
    to: S.SIGNE,
    permission: Permission.OUTGOING_SEND,
  },
  {
    from: [S.SIGNE, S.PRET_A_ENVOYER],
    event: 'SEND',
    to: S.ENVOYE,
    permission: Permission.OUTGOING_SEND,
  },
  { from: S.ENVOYE, event: 'DISCHARGE', to: S.DECHARGE },
  {
    from: [S.BROUILLON, S.EN_ATTENTE_VALIDATION, S.A_CORRIGER],
    event: 'CANCEL',
    to: S.ANNULE,
  },
  { from: [S.DECHARGE, S.ANNULE], event: 'ARCHIVE', to: S.ARCHIVE },
  // Back to the status it was archived from (VALIDE when unknown).
  { from: S.ARCHIVE, event: 'UNARCHIVE', to: ALL_BUT_ARCHIVE },
  { from: [S.DECHARGE, S.ANNULE], event: 'AUTO_ARCHIVE', to: S.ARCHIVE },
  { from: NOT_DONE, event: 'CANCEL_BY_PROJECT', to: S.ANNULE },
  { from: ALL, event: 'REOPEN_BY_PROJECT', to: ALL },
  { from: ALL_BUT_ARCHIVE, event: 'ARCHIVE_BY_PROJECT', to: S.ARCHIVE },
  { from: S.ARCHIVE, event: 'RESTORE_BY_PROJECT', to: ALL_BUT_ARCHIVE },
]);

/** The table of a courrier's direction. */
export function courrierStates(
  direction: CourrierDirection,
): TransitionTable<CourrierStatus, CourrierEvent> {
  return direction === CourrierDirection.SORTANT
    ? COURRIER_SORTANT_STATES
    : COURRIER_ENTRANT_STATES;
}
