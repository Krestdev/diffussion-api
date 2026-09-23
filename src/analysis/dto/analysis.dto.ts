import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import {
  IsArray,
  IsBoolean,
  IsDateString,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { AnalysisOpinion } from '../../../generated/prisma/enums';
import { PaginationQueryDto } from '../../common/dto/pagination.query.dto';

export class CreateAnalysisSheetDto {
  @ApiProperty({
    description: 'The delivery being analysed (courrier entrant)',
  })
  @IsUUID()
  courrierId: string;

  @ApiProperty({
    description:
      'Instruction this analysis answers — the fiche is deposited as one of its livrables',
  })
  @IsUUID()
  instructionId: string;

  @ApiPropertyOptional({ description: 'Projet / Marché' })
  @IsOptional()
  @IsUUID()
  projectId?: string;

  @ApiPropertyOptional({
    default: true,
    description:
      'Create one element per document attached to the courrier, each pre-filled with the default criteria grid',
  })
  @IsOptional()
  @IsBoolean()
  seedItemsFromCourrier?: boolean;

  @ApiPropertyOptional({ example: 'BL-2026-0042' })
  @IsOptional()
  @IsString()
  @MaxLength(50)
  refBL?: string;

  @ApiPropertyOptional({ example: 'Chantier Port Autonome' })
  @IsOptional()
  @IsString()
  @MaxLength(150)
  lieuUsage?: string;

  @ApiPropertyOptional({ example: '2026-09-10' })
  @IsOptional()
  @IsDateString()
  remise?: string;

  @ApiPropertyOptional({ example: 'NF EN 1992-1-1' })
  @IsOptional()
  @IsString()
  @MaxLength(150)
  norme?: string;

  @ApiPropertyOptional({
    type: [String],
    example: ["Dossier d'exécution", "Plans d'exécution"],
  })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  docsReferences?: string[];
}

// The delivery and the instruction are fixed once the fiche exists.
export class UpdateAnalysisSheetDto extends PartialType(
  CreateAnalysisSheetDto,
) {
  @ApiPropertyOptional({ readOnly: true })
  @IsOptional()
  @IsUUID()
  declare courrierId?: string;
}

export class CreateAnalysisItemDto {
  @ApiProperty({ description: 'The received document this element evaluates' })
  @IsUUID()
  documentId: string;

  @ApiProperty({ example: 'Plan de ferraillage' })
  @IsString()
  @MaxLength(200)
  label: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  description?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  observation?: string;

  @ApiPropertyOptional({
    description: 'Position in the fiche; appended at the end when omitted',
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  order?: number;
}

export class UpdateAnalysisItemDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(200)
  label?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  description?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  observation?: string;

  @ApiPropertyOptional({
    enum: AnalysisOpinion,
    description:
      "The expert's own avis on this element. The system suggests one from the criteria; this is what stands.",
  })
  @IsOptional()
  @IsEnum(AnalysisOpinion)
  opinion?: AnalysisOpinion;
}

export class SetCriterionDto {
  @ApiProperty({ example: 'Conformité aux cahiers des charges' })
  @IsString()
  @MaxLength(150)
  label: string;

  @ApiProperty({ enum: AnalysisOpinion })
  @IsEnum(AnalysisOpinion)
  opinion: AnalysisOpinion;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  observation?: string;

  @ApiPropertyOptional({ description: 'Criterion template it came from' })
  @IsOptional()
  @IsUUID()
  templateId?: string;
}

// Full-replace: the criteria listed become this element's complete grid.
export class SetCriteriaDto {
  @ApiProperty({ type: [SetCriterionDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => SetCriterionDto)
  criteria: SetCriterionDto[];
}

export class DecideAnalysisSheetDto {
  @ApiProperty({
    enum: AnalysisOpinion,
    description:
      'The avis that stands for the delivery. May differ from the suggestion — the decision belongs to the person in charge.',
  })
  @IsEnum(AnalysisOpinion)
  overallOpinion: AnalysisOpinion;

  @ApiPropertyOptional({
    description: 'Required when departing from the suggested avis',
  })
  @IsOptional()
  @IsString()
  motif?: string;
}

export class FindAnalysisSheetsQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  dossierId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  courrierId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  authorId?: string;

  @ApiPropertyOptional({ enum: AnalysisOpinion })
  @IsOptional()
  @IsEnum(AnalysisOpinion)
  overallOpinion?: AnalysisOpinion;
}

export class CreateCriterionTemplateDto {
  @ApiProperty({ example: 'Forme' })
  @IsString()
  @MaxLength(150)
  label: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  description?: string;

  @ApiPropertyOptional({
    description: 'Narrow this criterion to one dossier type',
  })
  @IsOptional()
  @IsUUID()
  dossierTypeId?: string;

  @ApiPropertyOptional({ default: 0 })
  @IsOptional()
  @IsInt()
  order?: number;

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class UpdateCriterionTemplateDto extends PartialType(
  CreateCriterionTemplateDto,
) {}
