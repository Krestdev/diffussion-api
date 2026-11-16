import { can } from '../auth/access/permission-checks';
import type { Permission } from '../auth/permissions';
import type { TransitionTable } from './transition-table';

/**
 * Why an action can't be taken right now. Detail responses list every action of an item the
 * person's permissions could ever allow, the blocked ones disabled with this reason (the UI
 * translates the code); an action the person can never take is left out (owner standard).
 */
export enum ActionBlockReason {
  /** The person's role doesn't include the permission (params.permission). */
  NO_PERMISSION = 'NO_PERMISSION',
  /** Not possible in the item's current status (params.status). */
  WRONG_STATUS = 'WRONG_STATUS',
  /**
   * Reserved to the person the item designates for it (its supervisor, validator, executant,
   * author or responsible: params.role).
   */
  NOT_DESIGNATED = 'NOT_DESIGNATED',
  /** One's own item: someone else decides on it. */
  OWN_ITEM = 'OWN_ITEM',
  /** The dossier (or the contract) the item belongs to is closed or archived. */
  DOSSIER_CLOSED = 'DOSSIER_CLOSED',
  /** Instructions of the item are still open. */
  INSTRUCTIONS_OPEN = 'INSTRUCTIONS_OPEN',
  /** Nothing waits for a decision (no submitted livrable, no proposal…). */
  NOTHING_TO_DECIDE = 'NOTHING_TO_DECIDE',
  /** A required piece is missing first (params.missing: e.g. VALIDATOR, DISPATCH, OPINIONS). */
  PREREQUISITE_MISSING = 'PREREQUISITE_MISSING',
  /** Done less than an hour ago (a reminder): wait before doing it again. */
  TOO_SOON = 'TOO_SOON',
}

export type ActionBlock = {
  reason: ActionBlockReason;
  params?: Record<string, string>;
};

export type ActionState<A extends string = string> = {
  action: A;
  enabled: boolean;
  reason?: ActionBlockReason;
  params?: Record<string, string>;
};

export const blocked = (
  reason: ActionBlockReason,
  params?: Record<string, string>,
): ActionBlock => ({ reason, params });

/** NO_PERMISSION unless the signed-in person holds `permission`. */
export const needsPermission = (permission: Permission): ActionBlock | null =>
  can(permission)
    ? null
    : blocked(ActionBlockReason.NO_PERMISSION, { permission });

/** WRONG_STATUS unless `table` allows `event` from `status`. */
export const needsStatus = <S extends string, E extends string>(
  table: TransitionTable<S, E>,
  status: S,
  event: E,
): ActionBlock | null =>
  table.allows(status, event)
    ? null
    : blocked(ActionBlockReason.WRONG_STATUS, { status });

/** WRONG_STATUS unless `status` is one of `allowed` (non-status actions: edit, remind…). */
export const needsStatusIn = <S extends string>(
  status: S,
  allowed: readonly S[],
): ActionBlock | null =>
  allowed.includes(status)
    ? null
    : blocked(ActionBlockReason.WRONG_STATUS, { status });

/** NOT_DESIGNATED (params.role) unless `designated`. */
export const needsDesignation = (
  designated: boolean,
  role: string,
): ActionBlock | null =>
  designated ? null : blocked(ActionBlockReason.NOT_DESIGNATED, { role });

/** Collects the actions of an item; the first failing check is the reason it is disabled. */
export class ActionStates<A extends string> {
  private readonly states: ActionState<A>[] = [];

  add(action: A, ...checks: (ActionBlock | false | null | undefined)[]): this {
    const block = checks.find((check): check is ActionBlock => !!check);
    this.states.push(
      block
        ? { action, enabled: false, reason: block.reason, params: block.params }
        : { action, enabled: true },
    );
    return this;
  }

  /**
   * Adds `action` only when the person could ever take it (`possible`: they hold one of the
   * permissions or designations that open it); otherwise it is left out.
   */
  addIf(
    possible: boolean,
    action: A,
    ...checks: (ActionBlock | false | null | undefined)[]
  ): this {
    return possible ? this.add(action, ...checks) : this;
  }

  get all(): ActionState<A>[] {
    return this.states;
  }

  get enabled(): A[] {
    return this.states.filter((s) => s.enabled).map((s) => s.action);
  }
}
