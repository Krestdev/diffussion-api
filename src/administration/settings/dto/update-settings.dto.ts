import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsInt, IsOptional, Max, Min, ValidateIf } from 'class-validator';

export class UpdateSettingsDto {
  @ApiPropertyOptional({
    type: Number,
    nullable: true,
    minimum: 1,
    description:
      'Most instructions in progress an agent should carry at once; null for no limit',
  })
  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsInt()
  @Min(1)
  @Max(1000)
  maxActiveInstructionsPerAgent?: number | null;
}
