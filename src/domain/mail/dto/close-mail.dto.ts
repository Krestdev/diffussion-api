import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength } from 'class-validator';
import { Trim } from '../../../common/transforms/trim.transform';

export class CloseMailDto {
  @ApiPropertyOptional({
    description:
      'Closing note (kept as closingNote and in its journal). Its open instructions are cancelled (ANNULEE).',
  })
  @IsOptional()
  @Trim()
  @IsString()
  @MaxLength(2000)
  note?: string;
}
