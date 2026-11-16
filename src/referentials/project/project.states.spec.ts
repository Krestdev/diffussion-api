import { ProjectStatus as S } from '../../../generated/prisma/client';
import { PROJECT_STATES, projectEventFor } from './project.states';

describe('PROJECT_STATES (was NEXT_STATUSES)', () => {
  it.each([
    [S.ACTIVE, S.CLOSED, 'CLOSE', 'project.update'],
    [S.CLOSED, S.ACTIVE, 'REOPEN', 'project.update'],
    [S.CLOSED, S.ARCHIVED, 'ARCHIVE', 'project.archive'],
    [S.ARCHIVED, S.CLOSED, 'UNARCHIVE', 'project.archive'],
  ] as const)('%s to %s by %s (%s)', (from, to, event, permission) => {
    expect(projectEventFor(from, to)).toBe(event);
    expect(PROJECT_STATES.resolve(from, event)?.to).toBe(to);
    expect(PROJECT_STATES.permissionOf(event)).toBe(permission);
  });

  it.each([
    [S.ACTIVE, S.ARCHIVED],
    [S.ARCHIVED, S.ACTIVE],
    [S.ACTIVE, S.ACTIVE],
    [S.CLOSED, S.CLOSED],
  ])('never skips a step: %s to %s', (from, to) => {
    expect(projectEventFor(from, to)).toBeUndefined();
  });

  it('has exactly those four rules', () => {
    expect(PROJECT_STATES.all).toHaveLength(4);
  });
});
