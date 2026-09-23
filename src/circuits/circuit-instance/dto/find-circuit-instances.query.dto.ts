import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  IsBoolean,
  IsEnum,
  IsInt,
  IsOptional,
  IsUUID,
  Max,
  Min,
} from 'class-validator';
import { CircuitInstanceStatus } from 'generated/prisma/enums';

export const DEFAULT_CIRCUIT_TAKE = 20;

export class FindCircuitInstancesQueryDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  dossierId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  courrierId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  documentId?: string;

  @ApiPropertyOptional({ enum: CircuitInstanceStatus })
  @IsOptional()
  @IsEnum(CircuitInstanceStatus)
  status?: CircuitInstanceStatus;

  /**
   * When true, only returns IN_PROGRESS instances where the acting user
   * holds the role required by the current step at the target's site —
   * the "awaiting my decision" inbox filter.
   */
  @ApiPropertyOptional({
    description:
      'When true, only instances where the calling user can act on the current step are returned.',
  })
  @IsOptional()
  @Transform(({ value }) => value === 'true' || value === true)
  @IsBoolean()
  awaitingMyDecision?: boolean;

  @ApiPropertyOptional({ default: 0 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  skip?: number;

  @ApiPropertyOptional({ default: DEFAULT_CIRCUIT_TAKE, maximum: 100 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  take?: number;
}
