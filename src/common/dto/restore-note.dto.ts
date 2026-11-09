import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength } from 'class-validator';

export class RestoreNoteDto {
  @ApiPropertyOptional({
    description:
      'Why it is restored (kept in its history and the audit journal)',
  })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  note?: string;
}
