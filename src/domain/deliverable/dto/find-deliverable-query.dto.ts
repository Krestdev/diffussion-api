import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsEnum, IsInt, IsOptional, IsUUID } from 'class-validator';
import { LivrableStatus } from 'generated/prisma/enums';

export class FindDeliverableQueryDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  instructionId?: string;

  @ApiPropertyOptional({ enum: LivrableStatus })
  @IsOptional()
  @IsEnum(LivrableStatus)
  status?: LivrableStatus;

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
