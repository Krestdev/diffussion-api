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
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { InstructionPriority } from 'generated/prisma/enums';

export class CreateInstructionLivrableDto {
  @ApiProperty({ example: 'Rapport de conformité' })
  @IsString()
  @MaxLength(200)
  title: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  description?: string;
}

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

  @ApiPropertyOptional({
    example: '2026-09-15',
    description: "The task's deadline: validated by then",
  })
  @IsOptional()
  @IsDateString()
  dueDate?: string;

  @ApiPropertyOptional({
    example: '2026-09-10',
    description:
      "The executants' deadline: livrables submitted by then. Not after dueDate. Usually set by the superviseur (PATCH /instructions/:id/delai-execution).",
  })
  @IsOptional()
  @IsDateString()
  agentDueDate?: string;

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

  @ApiPropertyOptional({
    description: 'Parent task this one depends on (sub-task)',
  })
  @IsOptional()
  @IsUUID()
  dependsOnId?: string;

  @ApiPropertyOptional({
    type: [CreateInstructionLivrableDto],
    description: 'Initial deliverables defined for this task',
  })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CreateInstructionLivrableDto)
  livrables?: CreateInstructionLivrableDto[];
}
