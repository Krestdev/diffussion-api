import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength } from 'class-validator';

export class CloseInstructionDto {
  @ApiPropertyOptional({ description: 'Closing comment' })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  comment?: string;
}
