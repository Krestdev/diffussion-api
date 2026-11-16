import { ContractStatus } from '../../generated/prisma/client';
import { Permission } from '../../auth/permissions';
import { TransitionTable } from '../../workflow/transition-table';

const S = ContractStatus;

/** Events on Contract.status, as today: archived and restored, alone or with its project. */
export type ContractEvent =
  'ARCHIVE' | 'UNARCHIVE' | 'ARCHIVE_BY_PROJECT' | 'RESTORE_BY_PROJECT';

export const CONTRACT_STATES = new TransitionTable<
  ContractStatus,
  ContractEvent
>('Contract', 'status', [
  {
    from: S.ACTIVE,
    event: 'ARCHIVE',
    to: S.ARCHIVED,
    permission: Permission.CONTRACT_ARCHIVE,
  },
  {
    from: S.ARCHIVED,
    event: 'UNARCHIVE',
    to: S.ACTIVE,
    permission: Permission.CONTRACT_ARCHIVE,
  },
  { from: S.ACTIVE, event: 'ARCHIVE_BY_PROJECT', to: S.ARCHIVED },
  { from: S.ARCHIVED, event: 'RESTORE_BY_PROJECT', to: S.ACTIVE },
]);
