import { DossierStatus as S } from '../../generated/prisma/client';
import { DOSSIER_STATES, DossierEvent } from './dossier.states';

// Today's dossier lifecycle (status map §6, §1c): from, event, to, permission.
const ACTIVE = [S.OPEN, S.IN_PROGRESS, S.PENDING, S.LATE];
const RULES: [S[], DossierEvent, S[], string | undefined][] = [
  [[S.OPEN], 'MARK_IN_PROGRESS', [S.IN_PROGRESS], undefined],
  [[S.OPEN, S.IN_PROGRESS, S.PENDING], 'MARK_LATE', [S.LATE], undefined],
  [ACTIVE, 'DUE_DATE_CHANGED', [S.LATE, S.IN_PROGRESS], 'dossier.update'],
  [ACTIVE, 'CLOSE', [S.CLOSED], 'dossier.close'],
  [[S.CLOSED], 'REOPEN', [S.IN_PROGRESS, S.LATE], 'dossier.reopen'],
  [[S.CLOSED], 'ARCHIVE', [S.ARCHIVED], 'dossier.archive'],
  [[S.ARCHIVED], 'UNARCHIVE', [S.CLOSED], 'dossier.archive'],
  [ACTIVE, 'CLOSE_BY_PROJECT', [S.CLOSED], undefined],
  [[S.CLOSED], 'REOPEN_BY_PROJECT', [S.IN_PROGRESS, S.LATE], undefined],
  [[S.CLOSED], 'ARCHIVE_BY_PROJECT', [S.ARCHIVED], undefined],
  [[S.ARCHIVED], 'RESTORE_BY_PROJECT', [S.CLOSED], undefined],
];

describe('DOSSIER_STATES', () => {
  it.each(RULES)('%j by %s leads to %j', (froms, event, tos, permission) => {
    expect(DOSSIER_STATES.sourcesOf(event).sort()).toEqual([...froms].sort());
    expect(DOSSIER_STATES.permissionOf(event)).toBe(permission);
    for (const from of froms) {
      const rule = DOSSIER_STATES.resolve(from, event)!;
      for (const to of tos) expect(DOSSIER_STATES.target(rule, to)).toBe(to);
    }
  });

  it('covers every rule of the table', () => {
    expect(DOSSIER_STATES.all).toHaveLength(RULES.length);
  });

  it.each([
    [S.CLOSED, 'CLOSE'],
    [S.ARCHIVED, 'CLOSE'],
    [S.OPEN, 'REOPEN'],
    [S.IN_PROGRESS, 'ARCHIVE'],
    [S.CLOSED, 'UNARCHIVE'],
    [S.LATE, 'MARK_LATE'],
    [S.IN_PROGRESS, 'MARK_IN_PROGRESS'],
    [S.CLOSED, 'DUE_DATE_CHANGED'],
  ] as [S, DossierEvent][])('refuses %s by %s', (from, event) => {
    expect(DOSSIER_STATES.allows(from, event)).toBe(false);
  });

  it('never leaves a dossier PENDING (never set today)', () => {
    for (const rule of DOSSIER_STATES.all) {
      expect([rule.to].flat()).not.toContain(S.PENDING);
    }
  });
});
