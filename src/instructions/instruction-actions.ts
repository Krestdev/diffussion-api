import {
  InstructionStatus,
  LivrableStatus,
  SubscriptionDecision,
  UserInstructionRole,
} from '../../generated/prisma/client';
import { can } from '../auth/access/permission-checks';
import { Permission } from '../auth/permissions';
import {
  ActionBlockReason,
  ActionState,
  ActionStates,
  blocked,
  needsStatus,
  needsStatusIn,
} from '../workflow/action-states';
import { LIVRABLE_STATES } from '../domain/deliverable/livrable.states';
import {
  INSTRUCTION_DECIDING,
  INSTRUCTION_NOT_TERMINAL,
  INSTRUCTION_STATES,
} from './instruction.states';

/** What the UI may draw on a task's page (GET /instructions/:id `actions`). */
export type InstructionAction =
  | 'edit'
  | 'setAgentDueDate'
  | 'assign'
  | 'remind'
  | 'subscribe'
  | 'decline'
  | 'deposit'
  | 'approveLivrables'
  | 'requestCorrections'
  | 'close'
  | 'cancel'
  | 'addLivrable';

/** What the UI may draw on each of its livrables (`livrables[].actions`). */
export type LivrableAction =
  | 'edit'
  | 'delete'
  | 'deposit'
  | 'submit'
  | 'giveOpinion'
  | 'approve'
  | 'reject'
  | 'newVersion';

/** The executants are reminded once an hour at most (InstructionsService.remind). */
export const REMIND_INTERVAL_MS = 60 * 60 * 1000;

/** The task's executants owe something (InstructionsService REMINDABLE_STATUSES). */
export const REMINDABLE_STATUSES: readonly InstructionStatus[] = [
  InstructionStatus.AFFECTEE,
  InstructionStatus.EN_COURS,
  InstructionStatus.A_CORRIGER,
];

export interface ActionsInstruction {
  status: InstructionStatus;
  createdById: string | null;
  lastRemindedAt?: Date | null;
  assignees: { role: UserInstructionRole; user: { id: string } }[];
  subscriptions?: { userId: string; decision: SubscriptionDecision }[];
  livrables: {
    id: string;
    status: LivrableStatus;
    isLatest: boolean;
    validationStep: number;
  }[];
}

export interface ActionsContext {
  userId: string;
  /** The supervisor of the effet the task comes from (assigns its tasks without a role). */
  courrierSupervisorId?: string | null;
  /** Its dossier is still worked on (or its contract still active). */
  workspaceOpen: boolean;
  now?: Date;
}

/**
 * The actions of a task and of each of its livrables, for the signed-in person. The same rules
 * as the routes: an action the person can never take (neither its permission nor the designation
 * that opens it) is left out; the others are enabled, or disabled with the first reason.
 */
export function instructionActions(
  instruction: ActionsInstruction,
  context: ActionsContext,
): {
  actions: ActionState<InstructionAction>[];
  livrables: Map<string, ActionState<LivrableAction>[]>;
} {
  const { userId } = context;
  const now = context.now ?? new Date();
  const holding = (role: UserInstructionRole) =>
    instruction.assignees
      .filter((assignee) => assignee.role === role)
      .map((assignee) => assignee.user.id);
  const executants = holding(UserInstructionRole.EXECUTANT);
  const superviseurs = holding(UserInstructionRole.SUPERVISEUR);
  const validateur = holding(UserInstructionRole.VALIDATEUR)[0];
  // validationChain: the superviseur decides, else the creator.
  const decider = superviseurs[0] ?? instruction.createdById;
  const isExecutant = executants.includes(userId);
  const isSubscriber =
    isExecutant &&
    (instruction.subscriptions ?? []).some(
      (subscription) =>
        subscription.userId === userId &&
        subscription.decision === SubscriptionDecision.SOUSCRITE,
    );
  const isSuperviseur = superviseurs.includes(userId);
  const isCreator = instruction.createdById === userId;
  const isDecider = decider === userId;
  const isValidateur = validateur === userId;
  const supervisesEffet =
    !!context.courrierSupervisorId && context.courrierSupervisorId === userId;
  const status = instruction.status;
  const notTerminal = needsStatusIn(status, INSTRUCTION_NOT_TERMINAL);
  const workspaceClosed = context.workspaceOpen
    ? null
    : blocked(ActionBlockReason.DOSSIER_CLOSED);
  const latest = instruction.livrables.filter((livrable) => livrable.isLatest);
  const awaitsAvis = (livrable: { validationStep: number }) =>
    !!validateur && livrable.validationStep === 0;
  const decidable = instruction.livrables.filter(
    (livrable) =>
      livrable.status === LivrableStatus.SOUMIS && !awaitsAvis(livrable),
  );
  const nothingToDecide = decidable.length
    ? null
    : blocked(ActionBlockReason.NOTHING_TO_DECIDE);

  // setAgentDueDate: the superviseur, or the creator when it has none; never the validateur.
  const setsDeadline =
    !isValidateur && (superviseurs.length ? isSuperviseur : isCreator);
  const remindedRecently =
    !!instruction.lastRemindedAt &&
    now.getTime() - instruction.lastRemindedAt.getTime() < REMIND_INTERVAL_MS;

  const actions = new ActionStates<InstructionAction>()
    .addIf(can(Permission.INSTRUCTION_UPDATE), 'edit', notTerminal)
    .addIf(setsDeadline, 'setAgentDueDate', notTerminal)
    .addIf(
      can(Permission.INSTRUCTION_ASSIGN) || supervisesEffet,
      'assign',
      needsStatus(INSTRUCTION_STATES, status, 'ASSIGN'),
    )
    .addIf(
      isSuperviseur || isCreator || can(Permission.ROLE_ASSIGN),
      'remind',
      needsStatusIn(status, REMINDABLE_STATUSES),
      !executants.length &&
        blocked(ActionBlockReason.PREREQUISITE_MISSING, {
          missing: 'EXECUTANT',
        }),
      remindedRecently && blocked(ActionBlockReason.TOO_SOON),
    )
    .addIf(
      isExecutant,
      'subscribe',
      needsStatus(INSTRUCTION_STATES, status, 'SUBSCRIBE'),
    )
    .addIf(
      isExecutant,
      'decline',
      needsStatus(INSTRUCTION_STATES, status, 'DECLINE'),
    )
    .addIf(
      isSubscriber,
      'deposit',
      needsStatus(INSTRUCTION_STATES, status, 'DEPOSIT'),
      workspaceClosed,
      !latest.some(
        (livrable) =>
          livrable.status === LivrableStatus.EN_PREPARATION ||
          livrable.status === LivrableStatus.REJETE,
      ) &&
        blocked(ActionBlockReason.PREREQUISITE_MISSING, {
          missing: 'LIVRABLE',
        }),
    )
    .addIf(
      isDecider,
      'approveLivrables',
      needsStatus(INSTRUCTION_STATES, status, 'APPROVE_LIVRABLES'),
      nothingToDecide,
    )
    .addIf(
      isDecider,
      'requestCorrections',
      needsStatus(INSTRUCTION_STATES, status, 'REQUEST_CORRECTIONS'),
      nothingToDecide,
    )
    .addIf(
      can(Permission.INSTRUCTION_CLOSE),
      'close',
      needsStatus(INSTRUCTION_STATES, status, 'CLOSE'),
      latest.some((livrable) => livrable.status !== LivrableStatus.VALIDE) &&
        blocked(ActionBlockReason.PREREQUISITE_MISSING, {
          missing: 'VALIDATED_LIVRABLES',
        }),
    )
    .addIf(
      can(Permission.INSTRUCTION_CANCEL),
      'cancel',
      needsStatus(INSTRUCTION_STATES, status, 'CANCEL'),
    )
    .addIf(
      isSubscriber || can(Permission.DELIVERABLE_CREATE),
      'addLivrable',
      notTerminal,
      workspaceClosed,
    );

  const deciding = needsStatusIn(status, INSTRUCTION_DECIDING);
  const prepares = isSubscriber || can(Permission.DELIVERABLE_CREATE);
  const versions = isSubscriber || can(Permission.DELIVERABLE_UPDATE);
  const livrables = new Map<string, ActionState<LivrableAction>[]>();
  for (const livrable of instruction.livrables) {
    const inPreparation = needsStatusIn(livrable.status, [
      LivrableStatus.EN_PREPARATION,
    ]);
    const awaitingDecision =
      livrable.status !== LivrableStatus.SOUMIS
        ? blocked(ActionBlockReason.WRONG_STATUS, { status: livrable.status })
        : awaitsAvis(livrable)
          ? blocked(ActionBlockReason.NOTHING_TO_DECIDE)
          : null;
    livrables.set(
      livrable.id,
      new ActionStates<LivrableAction>()
        .addIf(prepares, 'edit', inPreparation)
        .addIf(prepares, 'delete', inPreparation)
        .addIf(
          isSubscriber,
          'deposit',
          needsStatus(LIVRABLE_STATES, livrable.status, 'DEPOSIT'),
        )
        .addIf(
          isSubscriber,
          'submit',
          needsStatusIn(livrable.status, [LivrableStatus.DEPOSE]),
          needsStatus(INSTRUCTION_STATES, status, 'DEPOSIT'),
        )
        .addIf(
          isValidateur,
          'giveOpinion',
          deciding,
          (livrable.status !== LivrableStatus.SOUMIS ||
            livrable.validationStep !== 0) &&
            blocked(ActionBlockReason.NOTHING_TO_DECIDE),
        )
        .addIf(isDecider, 'approve', deciding, awaitingDecision)
        .addIf(isDecider, 'reject', deciding, awaitingDecision)
        .addIf(
          versions,
          'newVersion',
          !livrable.isLatest &&
            blocked(ActionBlockReason.WRONG_STATUS, { status: 'REPLACED' }),
          needsStatusIn(livrable.status, [LivrableStatus.REJETE]),
          workspaceClosed,
          // The instruction is not settled (DeliverableService.assertInstructionDossierOpen).
          notTerminal,
        ).all,
    );
  }
  return { actions: actions.all, livrables };
}
