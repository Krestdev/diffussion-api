import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsEnum, IsInt, IsOptional, IsString, IsUUID } from 'class-validator';
import { DossierPriority, DossierStatus } from 'generated/prisma/enums';

export class FindDossiersQueryDto {
  @ApiPropertyOptional({ description: 'Search in title/number' })
  @IsOptional()
  @IsString()
  search?: string;

  @ApiPropertyOptional({ enum: DossierStatus })
  @IsOptional()
  @IsEnum(DossierStatus)
  status?: DossierStatus;

  @ApiPropertyOptional({ enum: DossierPriority })
  @IsOptional()
  @IsEnum(DossierPriority)
  priority?: DossierPriority;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  siteId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  responsibleId?: string;

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
