import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsOptional, IsString } from 'class-validator';
import { ValidationDecision } from 'generated/prisma/enums';

export class DecideCircuitInstanceDto {
  @ApiProperty({ enum: ValidationDecision })
  @IsEnum(ValidationDecision)
  decision: ValidationDecision;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  motif?: string;
}
