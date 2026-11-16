import { InstructionStatus } from '../generated/prisma/client';
import { Permission } from '../auth/permissions';
import { TransitionTable } from '../workflow/transition-table';

const S = InstructionStatus;

/**
 * Events on Instruction.status, as Diffusion does them today (owner 2026-11-15), with the
 * approved fix: asking for corrections settles the validation round like a rejection (no
 * A_CORRIGER while other livrables are still SOUMIS). Designations (executant, superviseur,
 * validateur, decider, courrier supervisor) are checked by the services.
 */
export type InstructionEvent =
  | 'ASSIGN'
  | 'SUBSCRIBE'
  | 'DECLINE'
  | 'DEPOSIT'
  | 'APPROVE_LIVRABLES'
  | 'REJECT_LIVRABLE'
  | 'REQUEST_CORRECTIONS'
  | 'SUBMIT_ANALYSIS'
  | 'DECIDE_ANALYSIS'
  | 'CLOSE'
  | 'CANCEL'
  | 'CANCEL_BY_COURRIER'
  | 'CANCEL_BY_PROJECT'
  | 'REOPEN_BY_PROJECT';

const ALL: readonly InstructionStatus[] = Object.values(InstructionStatus);

/** Not settled yet (TERMINEE and ANNULEE are final). */
export const INSTRUCTION_NOT_TERMINAL: readonly InstructionStatus[] =
  ALL.filter((status) => status !== S.TERMINEE && status !== S.ANNULEE);

/** Where submitted livrables are decided (instructions.service DECIDING_STATUSES). */
export const INSTRUCTION_DECIDING: readonly InstructionStatus[] = [
  S.EN_ATTENTE_VALIDATION,
  S.A_CORRIGER,
];

/** Work started and livrables may be handed in. */
const AT_WORK: readonly InstructionStatus[] = [
  S.EN_COURS,
  S.A_CORRIGER,
  S.EN_ATTENTE_VALIDATION,
];

export const INSTRUCTION_STATES = new TransitionTable<
  InstructionStatus,
  InstructionEvent
>('Instruction', 'status', [
  // New executants: AFFECTEE; none (a superviseur alone): A_AFFECTER. Changing only the
  // superviseur or the validateur changes no status (owner fix 2026-11-15).
  {
    from: INSTRUCTION_NOT_TERMINAL,
    event: 'ASSIGN',
    to: [S.AFFECTEE, S.A_AFFECTER],
  },
  // The first executant to subscribe takes the task.
  { from: S.AFFECTEE, event: 'SUBSCRIBE', to: S.EN_COURS },
  // A decline: AFFECTEE while other executants remain, NON_SOUSCRITE after the last one.
  {
    from: S.AFFECTEE,
    event: 'DECLINE',
    to: [S.AFFECTEE, S.NON_SOUSCRITE],
  },
  // Livrables handed in (POST /instructions/:id/livrables/deposer, POST /deliverables/:id/submit).
  { from: AT_WORK, event: 'DEPOSIT', to: S.EN_ATTENTE_VALIDATION },
  // The decider's decisions settle the round: A_CORRIGER while rejected livrables remain,
  // TERMINEE once every current livrable is VALIDE.
  {
    from: INSTRUCTION_DECIDING,
    event: 'APPROVE_LIVRABLES',
    to: [S.A_CORRIGER, S.TERMINEE],
  },
  {
    from: INSTRUCTION_DECIDING,
    event: 'REJECT_LIVRABLE',
    to: [S.A_CORRIGER, S.TERMINEE],
  },
  {
    from: INSTRUCTION_DECIDING,
    event: 'REQUEST_CORRECTIONS',
    to: [S.A_CORRIGER, S.TERMINEE],
  },
  // A fiche d'analyse submitted, then decided (analysis-sheet.service).
  {
    from: INSTRUCTION_NOT_TERMINAL,
    event: 'SUBMIT_ANALYSIS',
    to: S.EN_ATTENTE_VALIDATION,
  },
  {
    from: INSTRUCTION_NOT_TERMINAL,
    event: 'DECIDE_ANALYSIS',
    to: [S.TERMINEE, S.A_CORRIGER],
  },
  {
    from: AT_WORK,
    event: 'CLOSE',
    to: S.TERMINEE,
    permission: Permission.INSTRUCTION_CLOSE,
  },
  {
    from: INSTRUCTION_NOT_TERMINAL,
    event: 'CANCEL',
    to: S.ANNULEE,
    permission: Permission.INSTRUCTION_CANCEL,
  },
  // Its effet was closed (mail.service close): 'Effet clôturé'.
  {
    from: INSTRUCTION_NOT_TERMINAL,
    event: 'CANCEL_BY_COURRIER',
    to: S.ANNULEE,
  },
  { from: INSTRUCTION_NOT_TERMINAL, event: 'CANCEL_BY_PROJECT', to: S.ANNULEE },
  // Back to its statusBeforeProjectClosure, whatever it became since (today's cascade).
  { from: ALL, event: 'REOPEN_BY_PROJECT', to: ALL },
]);
