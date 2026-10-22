import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsDateString,
  IsEnum,
  IsIn,
  IsOptional,
  IsUUID,
} from 'class-validator';
import { DossierPriority } from 'generated/prisma/enums';
import { PaginationQueryDto } from '../../../common/dto/pagination.query.dto';

/**
 * Tabs of the Approbation page, all relative to the caller:
 * - pending:  in progress, and the caller can decide the current step;
 * - accepted: the caller recorded a VALIDE decision on it;
 * - rejected: the caller recorded REJETE or CORRECTIONS_DEMANDEES on it.
 */
export const APPROBATION_TABS = ['pending', 'accepted', 'rejected'] as const;
export type ApprobationTab = (typeof APPROBATION_TABS)[number];

/** What the circuit is reviewing — the table's "Type" column. */
export const APPROBATION_TARGETS = [
  'COURRIER_ENTRANT',
  'COURRIER_SORTANT',
  'DOCUMENT',
] as const;
export type ApprobationTarget = (typeof APPROBATION_TARGETS)[number];

/**
 * Filters for GET /circuit-instances/approbation. `search` (inherited)
 * matches the courrier's number/subject/printed reference, the document's
 * name, or the dossier's number/title. The date range applies to the
 * target's registration date — the "Enregistré le" column.
 */
export class FindApprobationQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: APPROBATION_TABS, default: 'pending' })
  @IsOptional()
  @IsIn(APPROBATION_TABS)
  tab?: ApprobationTab;

  @ApiPropertyOptional({ enum: APPROBATION_TARGETS })
  @IsOptional()
  @IsIn(APPROBATION_TARGETS)
  targetType?: ApprobationTarget;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  circuitId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  dossierId?: string;

  @ApiPropertyOptional({ enum: DossierPriority })
  @IsOptional()
  @IsEnum(DossierPriority)
  priority?: DossierPriority;

  @ApiPropertyOptional({
    example: '2026-09-01',
    description: 'Target registered on or after this date',
  })
  @IsOptional()
  @IsDateString()
  createdFrom?: string;

  @ApiPropertyOptional({
    example: '2026-09-30',
    description:
      'Target registered on or before this date (a bare date includes the whole day)',
  })
  @IsOptional()
  @IsDateString()
  createdTo?: string;
}
