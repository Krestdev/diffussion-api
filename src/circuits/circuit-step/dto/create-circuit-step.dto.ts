import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsInt, IsOptional, IsString, IsUUID, Min } from 'class-validator';

export class CreateCircuitStepDto {
  @ApiProperty()
  @IsUUID()
  circuitId: string;

  @ApiProperty({ example: 1, description: 'Position in the circuit' })
  @IsInt()
  @Min(1)
  order: number;

  @ApiPropertyOptional({ example: 'VERIFICATION' })
  @IsOptional()
  @IsString()
  actionType?: string;

  @ApiPropertyOptional({
    description:
      'Step to fall back to on rejection ("si rejet, retour à l’étape")',
  })
  @IsOptional()
  @IsUUID()
  parentStepId?: string;

  @ApiPropertyOptional({ example: 48 })
  @IsOptional()
  @IsInt()
  @Min(1)
  maxDelayHours?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  condition?: string;

  @ApiPropertyOptional({ description: 'Role required to act on this step' })
  @IsOptional()
  @IsUUID()
  roleId?: string;
}
