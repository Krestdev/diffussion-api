import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength } from 'class-validator';

export class ArchiveReasonDto {
  @ApiPropertyOptional({
    description: 'Why it is archived (kept on it as archiveReason)',
  })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  reason?: string;
}
