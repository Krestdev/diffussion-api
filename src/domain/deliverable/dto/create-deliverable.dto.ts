import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';

export class CreateDeliverableDto {
  @ApiProperty({ description: 'Instruction this livrable answers (7.4)' })
  @IsUUID()
  instructionId: string;

  @ApiProperty({ example: 'Rapport de conformité' })
  @IsString()
  @MaxLength(200)
  title: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  description?: string;
}
