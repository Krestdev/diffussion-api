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

/**
 * The three tabs of the "Courriers sortants" page. Each one groups several
 * statuses, so the frontend can't express it as a single `status` filter.
 */
export const OUTGOING_STATUS_GROUPS = {
  pending: [CourrierStatus.BROUILLON, CourrierStatus.EN_CIRCUIT],
  approved: [
    CourrierStatus.VALIDE,
    CourrierStatus.PRET_A_ENVOYER,
    CourrierStatus.ENVOYE,
  ],
  rejected: [CourrierStatus.A_CORRIGER, CourrierStatus.ANNULE],
} as const satisfies Record<string, readonly CourrierStatus[]>;

export type OutgoingStatusGroup = keyof typeof OUTGOING_STATUS_GROUPS;
const GROUPS = Object.keys(OUTGOING_STATUS_GROUPS) as OutgoingStatusGroup[];

/**
 * Filters for GET /courriers/sortants. `search` (inherited) matches the
 * subject, the internal number or the printed reference. The date range
 * applies to `createdAt` — the "Enregistré le" date the list displays.
 */
export class FindOutgoingMailsQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({
    enum: GROUPS,
    description:
      'Tab: pending = BROUILLON, EN_CIRCUIT · approved = VALIDE, PRET_A_ENVOYER, ENVOYE · rejected = A_CORRIGER, ANNULE',
  })
  @IsOptional()
  @IsIn(GROUPS)
  group?: OutgoingStatusGroup;

  @ApiPropertyOptional({
    enum: CourrierStatus,
    description: 'Exact status; combined with `group` if both are given',
  })
  @IsOptional()
  @IsEnum(CourrierStatus)
  status?: CourrierStatus;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  dossierId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  correspondentId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  natureId?: string;

  // Circuit owner (10.6) — e.g. "courriers assigned to me" (the Affectations
  // queue), distinct from who registered the courrier.
  @ApiPropertyOptional({ description: 'Circuit owner (user id)' })
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
