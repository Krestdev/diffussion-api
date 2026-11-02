import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsDateString,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
  ValidateNested,
} from 'class-validator';

// RG-INS-004 applies to livrables too: every rejection must be motivated.
export class RejectLivrableDto {
  @ApiProperty({ example: 'Le plan de masse est illisible' })
  @IsString()
  @MinLength(3)
  @MaxLength(2000)
  motif: string;
}

export class LivrableCorrectionDto extends RejectLivrableDto {
  @ApiProperty({ description: 'Submitted livrable of this instruction' })
  @IsUUID('4')
  livrableId: string;
}

export class RequestCorrectionsDto {
  @ApiProperty({
    type: [LivrableCorrectionDto],
    description:
      'Livrables to reject, each with its own motif. Submitted livrables not listed stay SOUMIS.',
  })
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => LivrableCorrectionDto)
  livrables: LivrableCorrectionDto[];

  @ApiPropertyOptional({ example: 'Merci de corriger avant vendredi' })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  comment?: string;

  @ApiPropertyOptional({
    example: '2026-11-15',
    description: "New executants' deadline for the correction round",
  })
  @IsOptional()
  @IsDateString()
  agentDueDate?: string;
}
