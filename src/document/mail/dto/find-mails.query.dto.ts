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
