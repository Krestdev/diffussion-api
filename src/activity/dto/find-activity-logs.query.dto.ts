import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsEnum, IsInt, IsOptional, IsString, IsUUID } from 'class-validator';
import { ActivityLevel, ActivitySource } from 'generated/prisma/enums';

export class FindActivityLogsQueryDto {
  @ApiPropertyOptional({ description: 'Search in action/message' })
  @IsOptional()
  @IsString()
  search?: string;

  @ApiPropertyOptional({ enum: ActivitySource })
  @IsOptional()
  @IsEnum(ActivitySource)
  source?: ActivitySource;

  @ApiPropertyOptional({ enum: ActivityLevel })
  @IsOptional()
  @IsEnum(ActivityLevel)
  level?: ActivityLevel;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  entityType?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  entityId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  userId?: string;

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
