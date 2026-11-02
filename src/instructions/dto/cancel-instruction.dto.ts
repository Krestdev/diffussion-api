import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength } from 'class-validator';

export class CancelInstructionDto {
  @ApiPropertyOptional({
    description: 'Reason for cancelling this instruction',
  })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  reason?: string;
}
