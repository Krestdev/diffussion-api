import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, Max, Min } from 'class-validator';
import { KeyQueryDto } from './key.query.dto';

export class SignedUrlQueryDto extends KeyQueryDto {
  @ApiPropertyOptional({ example: 900, description: 'Seconds until expiry' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(60)
  @Max(604800)
  expiresIn?: number;
}
