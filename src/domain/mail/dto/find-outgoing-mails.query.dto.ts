import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsDateString,
  IsEnum,
  IsIn,
  IsOptional,
  IsUUID,
} from 'class-validator';
import { CourrierStatus } from 'generated/prisma/enums';
import { PaginationQueryDto } from '../../../common/dto/pagination.query.dto';
import { COURRIER_STATUS_DOC } from './courrier-status.doc';

const AUTHORIZED = [
  CourrierStatus.VALIDE,
  CourrierStatus.SIGNE,
  CourrierStatus.PRET_A_ENVOYER,
  CourrierStatus.ENVOYE,
  CourrierStatus.DECHARGE,
] as const;

/**
 * The tabs of the "Courriers sortants" page, by status: drafts, submitted,
 * corrections, authorized, cancelled and archived — and the earlier
 * pending / approved / rejected grouping, still accepted.
 */
export const OUTGOING_STATUS_GROUPS = {
  drafts: [CourrierStatus.BROUILLON],
  submitted: [CourrierStatus.EN_ATTENTE_VALIDATION],
  corrections: [CourrierStatus.A_CORRIGER],
  authorized: AUTHORIZED,
  cancelled: [CourrierStatus.ANNULE],
  archived: [CourrierStatus.ARCHIVE],
  pending: [CourrierStatus.BROUILLON, CourrierStatus.EN_ATTENTE_VALIDATION],
  approved: AUTHORIZED,
  rejected: [CourrierStatus.A_CORRIGER, CourrierStatus.ANNULE],
} as const satisfies Record<string, readonly CourrierStatus[]>;

// The tabs counted in metrics.byTab, besides `all`.
export const OUTGOING_TABS = [
  'drafts',
  'submitted',
  'corrections',
  'authorized',
  'cancelled',
  'archived',
] as const satisfies readonly (keyof typeof OUTGOING_STATUS_GROUPS)[];

export type OutgoingStatusGroup = keyof typeof OUTGOING_STATUS_GROUPS;
const GROUPS = Object.keys(OUTGOING_STATUS_GROUPS) as OutgoingStatusGroup[];

/**
 * Filters for GET /courriers/sortants. `search` (inherited) matches the
 * subject, the internal number or the printed reference. The date range
 * applies to `createdAt` — the "Enregistré le" date the list displays.
 */
export class FindOutgoingMailsQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({
    description:
      "Only this site's effets — within those the caller may already see",
  })
  @IsOptional()
  @IsUUID('4')
  siteId?: string;

  @ApiPropertyOptional({
    enum: GROUPS,
    description:
      'Tab: drafts = BROUILLON · submitted = EN_ATTENTE_VALIDATION · corrections = A_CORRIGER · authorized = VALIDE, SIGNE, PRET_A_ENVOYER, ENVOYE, DECHARGE · cancelled = ANNULE · archived = ARCHIVE. Also: pending = BROUILLON, EN_ATTENTE_VALIDATION · approved = authorized · rejected = A_CORRIGER, ANNULE',
  })
  @IsOptional()
  @IsIn(GROUPS)
  group?: OutgoingStatusGroup;

  @ApiPropertyOptional({
    enum: CourrierStatus,
    description: `Exact status; combined with \`group\` if both are given. ${COURRIER_STATUS_DOC}`,
  })
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
    description: 'Registered on or after this date',
  })
  @IsOptional()
  @IsDateString()
  createdFrom?: string;

  @ApiPropertyOptional({
    example: '2026-09-30',
    description:
      'Registered on or before this date (a bare date includes the whole day)',
  })
  @IsOptional()
  @IsDateString()
  createdTo?: string;
}
