import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsEnum, IsInt, IsOptional, IsUUID } from 'class-validator';
import { CourrierDirection, CourrierStatus } from 'generated/prisma/enums';

export class FindMailsQueryDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  dossierId?: string;

  @ApiPropertyOptional({ enum: CourrierDirection })
  @IsOptional()
  @IsEnum(CourrierDirection)
  direction?: CourrierDirection;

  @ApiPropertyOptional({ enum: CourrierStatus })
  @IsOptional()
  @IsEnum(CourrierStatus)
  status?: CourrierStatus;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  correspondentId?: string;

  // Circuit owner (10.6) — used by the "Affectations" queue (courriers
  // assigned to me), distinct from filtering by who created the courrier.
  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  ownerId?: string;

  @ApiPropertyOptional({ default: 0 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  skip?: number;

  @ApiPropertyOptional({ default: 20 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  take?: number;
}
