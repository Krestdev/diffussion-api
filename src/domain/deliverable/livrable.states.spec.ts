import { LivrableStatus as S } from '../../generated/prisma/client';
import { LivrableEvent, LIVRABLE_STATES } from './livrable.states';

// Today's transitions (status map §4): no permission on the rules, the services check who acts.
const DOCUMENTED: [S, LivrableEvent, S][] = [
  [S.EN_PREPARATION, 'DEPOSIT', S.DEPOSE],
  [S.DEPOSE, 'SUBMIT', S.SOUMIS],
  [S.EN_PREPARATION, 'SUBMIT', S.SOUMIS],
  [S.SOUMIS, 'APPROVE', S.VALIDE],
  [S.EN_VALIDATION, 'APPROVE', S.VALIDE],
  [S.SOUMIS, 'REJECT', S.REJETE],
  [S.EN_VALIDATION, 'REJECT', S.REJETE],
];

const REFUSED: [S, LivrableEvent][] = [
  [S.DEPOSE, 'DEPOSIT'],
  [S.SOUMIS, 'SUBMIT'],
  [S.REJETE, 'SUBMIT'],
  [S.VALIDE, 'APPROVE'],
  [S.REJETE, 'REJECT'],
  [S.EN_PREPARATION, 'APPROVE'],
];

describe('LIVRABLE_STATES', () => {
  it.each(DOCUMENTED)('%s -> %s -> %s', (from, event, to) => {
    const rule = LIVRABLE_STATES.resolve(from, event);
    expect(rule).toBeDefined();
    expect(LIVRABLE_STATES.target(rule!)).toBe(to);
    expect(rule!.permission).toBeUndefined();
  });

  it.each(REFUSED)('refuses %s -> %s', (from, event) => {
    expect(LIVRABLE_STATES.allows(from, event)).toBe(false);
  });
});
