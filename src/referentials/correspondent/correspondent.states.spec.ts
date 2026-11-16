import { CorrespondentStatus as S } from '../../../generated/prisma/client';
import { CORRESPONDENT_STATES } from './correspondent.states';

describe('CORRESPONDENT_STATES', () => {
  it('turns a correspondent off and on with correspondent.archive', () => {
    expect(CORRESPONDENT_STATES.resolve(S.ACTIVE, 'DEACTIVATE')?.to).toBe(
      S.INACTIVE,
    );
    expect(CORRESPONDENT_STATES.resolve(S.INACTIVE, 'ACTIVATE')?.to).toBe(
      S.ACTIVE,
    );
    expect(CORRESPONDENT_STATES.permissionOf('DEACTIVATE')).toBe(
      'correspondent.archive',
    );
    expect(CORRESPONDENT_STATES.permissionOf('ACTIVATE')).toBe(
      'correspondent.archive',
    );
  });

  it('refuses turning off what is off, or on what is on', () => {
    expect(CORRESPONDENT_STATES.allows(S.INACTIVE, 'DEACTIVATE')).toBe(false);
    expect(CORRESPONDENT_STATES.allows(S.ACTIVE, 'ACTIVATE')).toBe(false);
  });
});
