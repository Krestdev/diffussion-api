import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { Trim } from '../../../common/transforms/trim.transform';

export class CancelMailDto {
  @ApiPropertyOptional({
    minLength: 10,
    description:
      'Why it is cancelled — required for a sortant (kept as cancellationReason and in its journal)',
  })
  @IsOptional()
  @Trim()
  @IsString()
  @MinLength(10)
  @MaxLength(1000)
  reason?: string;
}
