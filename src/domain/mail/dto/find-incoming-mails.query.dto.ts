import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsDateString, IsEnum, IsOptional, IsUUID } from 'class-validator';
import { CourrierStatus } from 'generated/prisma/enums';
import { PaginationQueryDto } from '../../../common/dto/pagination.query.dto';

/**
 * Tabs of the "Courriers entrants" page:
 * - all: all incoming courriers
 * - toDispatch: RECU, ENREGISTRE (À dispatcher)
 * - dispatchPending: EN_ATTENTE_TRANSMISSION (Dispatching à valider)
 * - assigned: TRANSMIS (Affectés)
 * - inTreatment: EN_TRAITEMENT (En traitement)
 * - closed: CLOTURE (Clôturés)
 * - archived: ARCHIVE (Archivés)
 * - others: every other status (Autres) — so that the tabs together hold
 *   every effet of "all".
 */
const NAMED_TABS = {
  toDispatch: [CourrierStatus.RECU, CourrierStatus.ENREGISTRE],
  dispatchPending: [CourrierStatus.EN_ATTENTE_TRANSMISSION],
  assigned: [CourrierStatus.TRANSMIS],
  inTreatment: [CourrierStatus.EN_TRAITEMENT],
  closed: [CourrierStatus.CLOTURE],
  archived: [CourrierStatus.ARCHIVE],
} as const satisfies Record<string, readonly CourrierStatus[]>;

const NAMED_STATUSES: readonly CourrierStatus[] =
  Object.values(NAMED_TABS).flat();

export const INCOMING_STATUS_TABS = {
  all: [],
  ...NAMED_TABS,
  others: Object.values(CourrierStatus).filter(
    (status) => !NAMED_STATUSES.includes(status),
  ),
} as const satisfies Record<string, readonly CourrierStatus[]>;

export type IncomingStatusTab = keyof typeof INCOMING_STATUS_TABS;

export function resolveIncomingTabStatuses(
  tab?: string,
): readonly CourrierStatus[] | undefined {
  if (!tab || tab === 'all' || tab === 'tous') return undefined;
  if (
    tab === 'toDispatch' ||
    tab === 'to-dispatch' ||
    tab === 'a-dispatcher' ||
    tab === 'aDispatcher'
  ) {
    return INCOMING_STATUS_TABS.toDispatch;
  }
  if (
    tab === 'dispatchPending' ||
    tab === 'dispatch-pending' ||
    tab === 'dispatching-a-valider' ||
    tab === 'dispatchingAValider'
  ) {
    return INCOMING_STATUS_TABS.dispatchPending;
  }
  if (
    tab === 'assigned' ||
    tab === 'affectes' ||
    tab === 'transmis' ||
    tab === 'transmitted'
  ) {
    return INCOMING_STATUS_TABS.assigned;
  }
  if (
    tab === 'inTreatment' ||
    tab === 'in-treatment' ||
    tab === 'en-traitement' ||
    tab === 'enTraitement' ||
    tab === 'inProgress' ||
    tab === 'in-progress'
  ) {
    return INCOMING_STATUS_TABS.inTreatment;
  }
  if (tab === 'closed' || tab === 'clotures' || tab === 'cloture') {
    return INCOMING_STATUS_TABS.closed;
  }
  if (tab === 'archives' || tab === 'archive') {
    return INCOMING_STATUS_TABS.archived;
  }
  if (tab === 'autres') {
    return INCOMING_STATUS_TABS.others;
  }
  if (tab in INCOMING_STATUS_TABS) {
    const statuses = INCOMING_STATUS_TABS[tab as IncomingStatusTab];
    return statuses.length > 0 ? statuses : undefined;
  }
  return undefined;
}

export enum IncomingMailSort {
  Newest = 'newest',
  Oldest = 'oldest',
}

/**
 * Filters for GET /courriers/entrants. `search` (inherited) matches the
 * subject, the internal number or the printed reference. The received-date
 * range applies to `receivedAt`, falling back to `createdAt` when the
 * reception date wasn't recorded — the same date the list displays.
 */
export class FindIncomingMailsQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({
    description:
      'Tab: all · toDispatch (RECU, ENREGISTRE) · dispatchPending (EN_ATTENTE_TRANSMISSION) · assigned (TRANSMIS) · inTreatment (EN_TRAITEMENT) · closed (CLOTURE) · archived (ARCHIVE) · others (every other status: EN_ATTENTE_VALIDATION, A_CORRIGER, VALIDE, ANNULE...)',
  })
  @IsOptional()
  tab?: string;

  @ApiPropertyOptional({ enum: CourrierStatus })
  @IsOptional()
  @IsEnum(CourrierStatus)
  status?: CourrierStatus;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  dossierId?: string;

  @ApiPropertyOptional({
    description: 'Only the courriers whose dossier is in this project',
  })
  @IsOptional()
  @IsUUID()
  projectId?: string;

  @ApiPropertyOptional({
    description: 'Only the courriers whose dossier is under this contract',
  })
  @IsOptional()
  @IsUUID()
  contractId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  correspondentId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  natureId?: string;

  @ApiPropertyOptional({ description: 'Effet type' })
  @IsOptional()
  @IsUUID()
  typeId?: string;

  // Person in charge — e.g. "courriers assigned to me" (the Affectations
  // queue), distinct from who registered the courrier.
  @ApiPropertyOptional({ description: 'Person in charge (user id)' })
  @IsOptional()
  @IsUUID()
  ownerId?: string;

  @ApiPropertyOptional({
    example: '2026-09-01',
    description: 'Received on or after this date',
  })
  @IsOptional()
  @IsDateString()
  receivedFrom?: string;

  @ApiPropertyOptional({
    example: '2026-09-30',
    description:
      'Received on or before this date (a bare date includes the whole day)',
  })
  @IsOptional()
  @IsDateString()
  receivedTo?: string;

  @ApiPropertyOptional({
    enum: IncomingMailSort,
    description: 'newest (default) or oldest first, based on receivedAt',
  })
  @IsOptional()
  @IsEnum(IncomingMailSort)
  sort?: IncomingMailSort;
}
