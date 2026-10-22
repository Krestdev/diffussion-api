import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsDateString, IsEnum, IsOptional, IsUUID } from 'class-validator';
import { CourrierStatus } from 'generated/prisma/enums';
import { PaginationQueryDto } from '../../../common/dto/pagination.query.dto';

/**
 * Filters for GET /courriers/entrants. `search` (inherited) matches the
 * subject, the internal number or the printed reference. The received-date
 * range applies to `receivedAt`, falling back to `createdAt` when the
 * reception date wasn't recorded — the same date the list displays.
 */
export class FindIncomingMailsQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: CourrierStatus })
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
}
