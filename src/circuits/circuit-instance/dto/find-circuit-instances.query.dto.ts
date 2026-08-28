import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsOptional, IsUUID } from 'class-validator';
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
}
