import { CorrespondentStatus } from '../../generated/prisma/client';
import { Permission } from '../../auth/permissions';
import { TransitionTable } from '../../workflow/transition-table';

const S = CorrespondentStatus;

/** Events on Correspondent.status (PATCH /correspondents/:uuid {status}): ACTIVE ⇄ INACTIVE. */
export type CorrespondentEvent = 'DEACTIVATE' | 'ACTIVATE';

export const CORRESPONDENT_STATES = new TransitionTable<
  CorrespondentStatus,
  CorrespondentEvent
>('Correspondent', 'status', [
  {
    from: S.ACTIVE,
    event: 'DEACTIVATE',
    to: S.INACTIVE,
    permission: Permission.CORRESPONDENT_ARCHIVE,
  },
  {
    from: S.INACTIVE,
    event: 'ACTIVATE',
    to: S.ACTIVE,
    permission: Permission.CORRESPONDENT_ARCHIVE,
  },
]);
