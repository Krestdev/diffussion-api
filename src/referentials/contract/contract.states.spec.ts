import { ContractStatus as S } from '../../generated/prisma/client';
import { CONTRACT_STATES, ContractEvent } from './contract.states';

describe('CONTRACT_STATES', () => {
  it.each([
    [S.ACTIVE, 'ARCHIVE', S.ARCHIVED, 'contract.archive'],
    [S.ARCHIVED, 'UNARCHIVE', S.ACTIVE, 'contract.archive'],
    [S.ACTIVE, 'ARCHIVE_BY_PROJECT', S.ARCHIVED, undefined],
    [S.ARCHIVED, 'RESTORE_BY_PROJECT', S.ACTIVE, undefined],
  ] as [S, ContractEvent, S, string | undefined][])(
    '%s by %s leads to %s',
    (from, event, to, permission) => {
      expect(CONTRACT_STATES.sourcesOf(event)).toEqual([from]);
      expect(CONTRACT_STATES.resolve(from, event)?.to).toBe(to);
      expect(CONTRACT_STATES.permissionOf(event)).toBe(permission);
    },
  );

  it.each([
    [S.ARCHIVED, 'ARCHIVE'],
    [S.ACTIVE, 'UNARCHIVE'],
    [S.ARCHIVED, 'ARCHIVE_BY_PROJECT'],
    [S.ACTIVE, 'RESTORE_BY_PROJECT'],
  ] as [S, ContractEvent][])('refuses %s by %s', (from, event) => {
    expect(CONTRACT_STATES.allows(from, event)).toBe(false);
  });
});
