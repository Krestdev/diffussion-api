import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  ArrayUnique,
  IsArray,
  IsDateString,
  IsEnum,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';
import { InstructionPriority } from 'generated/prisma/enums';

export class CreateInstructionsDto {
  @ApiProperty({ description: 'Dossier this instruction belongs to (7.3)' })
  @IsUUID()
  dossierId: string;

  @ApiPropertyOptional({
    description: 'Courrier that triggered this instruction, if any',
  })
  @IsOptional()
  @IsUUID()
  courrierId?: string;

  @ApiProperty({ example: 'Rédiger le rapport de conformité' })
  @IsString()
  @MaxLength(200)
  title: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  description?: string;

  @ApiPropertyOptional({
    enum: InstructionPriority,
    default: InstructionPriority.NORMAL,
  })
  @IsOptional()
  @IsEnum(InstructionPriority)
  priority?: InstructionPriority;

  @ApiPropertyOptional({ example: '2026-09-01' })
  @IsOptional()
  @IsDateString()
  dueDate?: string;

  @ApiPropertyOptional({
    type: [String],
    description: 'RG-INS-002: assigned directly to one or more executants',
  })
  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @IsUUID('4', { each: true })
  executantIds?: string[];

  @ApiPropertyOptional({
    description:
      'RG-INS-002: or to a superviseur responsible for designating executants',
  })
  @IsOptional()
  @IsUUID()
  superviseurId?: string;
}
