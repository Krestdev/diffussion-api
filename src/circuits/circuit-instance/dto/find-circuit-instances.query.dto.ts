import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsEnum, IsInt, IsOptional, IsUUID, Min } from 'class-validator';
import { CircuitInstanceStatus } from 'generated/prisma/enums';

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

  @ApiPropertyOptional({ default: 0 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  skip?: number;

  @ApiPropertyOptional({ default: 20 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  take?: number;
}
