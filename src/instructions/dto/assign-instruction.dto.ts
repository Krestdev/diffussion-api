import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  ArrayUnique,
  IsArray,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';

export class AssignInstructionDto {
  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @IsUUID('4', { each: true })
  executantIds?: string[];

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  superviseurId?: string;

  @ApiPropertyOptional({
    description: 'A new validateur; left out, the current one stays',
  })
  @IsOptional()
  @IsUUID('4')
  validateurId?: string;

  @ApiPropertyOptional({
    description: 'Free-text note about this (re)assignment',
  })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  note?: string;
}
