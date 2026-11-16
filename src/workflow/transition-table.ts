export interface TransitionRule<S extends string, E extends string> {
  from: S | readonly S[];
  event: E;
  /**
   * Status the event leads to. A list means the outcome depends on the entity (e.g. approving
   * the last step validates, approving an earlier one moves to the next step): the caller then
   * names the target, which must be one of these.
   */
  to: S | readonly S[];
  /** Permission the acting user must hold to trigger this transition. */
  permission?: string;
}

/**
 * The single source of truth for one entity's status field: which events are allowed
 * from which status, what status they lead to, and who may trigger them.
 */
export class TransitionTable<S extends string, E extends string> {
  constructor(
    /** Entity name recorded in StatusHistory, e.g. "Payment". */
    readonly entity: string,
    /** Status column the table governs, e.g. "status". */
    readonly field: string,
    private readonly rules: readonly TransitionRule<S, E>[],
  ) {
    const seen = new Set<string>();
    for (const rule of rules) {
      for (const from of this.froms(rule)) {
        const key = `${from}:${rule.event}`;
        if (seen.has(key)) {
          throw new Error(
            `${entity}.${field}: duplicate transition for ${key}`,
          );
        }
        seen.add(key);
      }
    }
  }

  resolve(from: S, event: E): TransitionRule<S, E> | undefined {
    return this.rules.find(
      (rule) => rule.event === event && this.froms(rule).includes(from),
    );
  }

  /** Events that can be triggered from `from`; used to tell the UI which actions to offer. */
  allowedEvents(from: S): E[] {
    return this.rules
      .filter((rule) => this.froms(rule).includes(from))
      .map((rule) => rule.event);
  }

  /** Whether `event` may be triggered from `from` (the permission aside). */
  allows(from: S, event: E): boolean {
    return this.resolve(from, event) !== undefined;
  }

  /** The statuses `event` may be triggered from. */
  sourcesOf(event: E): S[] {
    return this.rules
      .filter((rule) => rule.event === event)
      .flatMap((rule) => [...this.froms(rule)]);
  }

  /** The permission `event` needs (its rules all name the same one, or none). */
  permissionOf(event: E): string | undefined {
    return this.rules.find((rule) => rule.event === event)?.permission;
  }

  /** Every rule, for the table specs. */
  get all(): readonly TransitionRule<S, E>[] {
    return this.rules;
  }

  /** The status `rule` leads to, checking the caller's choice when it has several targets. */
  target(rule: TransitionRule<S, E>, chosen?: S): S {
    if (typeof rule.to === 'string') {
      if (chosen !== undefined && chosen !== rule.to) {
        throw new Error(
          `${this.entity}.${this.field}: ${rule.event} leads to ${rule.to}, not ${chosen}`,
        );
      }
      return rule.to;
    }
    if (chosen === undefined || !rule.to.includes(chosen)) {
      throw new Error(
        `${this.entity}.${this.field}: ${rule.event} needs a target among ${rule.to.join(', ')}`,
      );
    }
    return chosen;
  }

  private froms(rule: TransitionRule<S, E>): readonly S[] {
    return typeof rule.from === 'string' ? [rule.from] : rule.from;
  }
}
