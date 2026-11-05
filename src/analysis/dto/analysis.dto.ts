import {
  ApiProperty,
  ApiPropertyOptional,
  OmitType,
  PartialType,
} from '@nestjs/swagger';
import {
  IsArray,
  IsBoolean,
  IsDateString,
  IsEnum,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import {
  AnalysisOpinion,
  AnalysisSheetStatus,
} from '../../../generated/prisma/enums';
import { PaginationQueryDto } from '../../common/dto/pagination.query.dto';
import { Trim } from '../../common/transforms/trim.transform';

export class CreateAnalysisItemDto {
  @ApiPropertyOptional({
    description:
      'The received document this element evaluates (one of its courrier’s documents)',
  })
  @IsOptional()
  @IsUUID()
  documentId?: string;

  @ApiProperty({ example: 'Plan de ferraillage' })
  @IsString()
  @MaxLength(200)
  label: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  description?: string;

  @ApiPropertyOptional({ example: 'NF EN 1992-1-1' })
  @IsOptional()
  @IsString()
  norms?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  observation?: string;

  @ApiPropertyOptional({
    enum: AnalysisOpinion,
    description: "The expert's avis on this element",
  })
  @IsOptional()
  @IsEnum(AnalysisOpinion)
  opinion?: AnalysisOpinion;

  @ApiPropertyOptional({
    description: 'Position in the fiche; appended at the end when omitted',
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  order?: number;
}

export class CreateAnalysisSheetDto {
  @ApiProperty({
    description: 'The delivery being analysed (courrier entrant)',
  })
  @IsUUID()
  courrierId: string;

  @ApiPropertyOptional({
    description:
      'Instruction this analysis answers — the fiche is then deposited as one of its livrables. Omitted: a fiche opened from the effet alone.',
  })
  @IsOptional()
  @IsUUID()
  instructionId?: string;

  @ApiPropertyOptional({ description: 'Projet / Marché' })
  @IsOptional()
  @IsUUID()
  projectId?: string;

  @ApiPropertyOptional({
    default: true,
    description:
      'Without `items`: create one element per document attached to the courrier, each pre-filled with the default criteria grid',
  })
  @IsOptional()
  @IsBoolean()
  seedItemsFromCourrier?: boolean;

  @ApiPropertyOptional({
    type: [CreateAnalysisItemDto],
    description:
      'The elements to create with the fiche (instead of seeding them from the courrier)',
  })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CreateAnalysisItemDto)
  items?: CreateAnalysisItemDto[];

  @ApiPropertyOptional({ description: 'Objet de la remise', maxLength: 255 })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  title?: string;

  @ApiPropertyOptional({ maxLength: 100 })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  mode?: string;

  @ApiPropertyOptional({ maxLength: 100 })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  projectReference?: string;

  @ApiPropertyOptional({ description: "Maître d'ouvrage", maxLength: 255 })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  owner?: string;

  @ApiPropertyOptional({ description: 'Allotissement', maxLength: 255 })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  allotment?: string;

  @ApiPropertyOptional({ maxLength: 150 })
  @IsOptional()
  @IsString()
  @MaxLength(150)
  authorFunction?: string;

  @ApiPropertyOptional({
    description:
      'Who produced the fiche (active user) — the creator when omitted. For a fiche answering an instruction, an executant of it.',
  })
  @IsOptional()
  @IsUUID()
  authorId?: string;

  @ApiPropertyOptional({
    enum: AnalysisOpinion,
    description:
      "The fiche's overall avis, chosen by its author (a fiche answering an instruction gets it through /decide)",
  })
  @IsOptional()
  @IsEnum(AnalysisOpinion)
  overallOpinion?: AnalysisOpinion;

  @ApiPropertyOptional({ description: 'Who validates the fiche (active user)' })
  @IsOptional()
  @IsUUID()
  validatorId?: string;

  @ApiPropertyOptional({ maxLength: 150 })
  @IsOptional()
  @IsString()
  @MaxLength(150)
  validatorFunction?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  comments?: string;

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

// The statuses PATCH may move a fiche between; signing and archiving have
// their own routes.
export const EDITABLE_SHEET_STATUSES = [
  AnalysisSheetStatus.BROUILLON,
  AnalysisSheetStatus.ENREGISTREE,
] as const;

// The delivery and the instruction are fixed once the fiche exists.
export class UpdateAnalysisSheetDto extends PartialType(
  OmitType(CreateAnalysisSheetDto, ['items'] as const),
) {
  @ApiPropertyOptional({ readOnly: true })
  @IsOptional()
  @IsUUID()
  declare courrierId?: string;

  @ApiPropertyOptional({
    enum: EDITABLE_SHEET_STATUSES,
    description:
      'BROUILLON ⇄ ENREGISTREE. SIGNEE and ARCHIVEE go through /sign and /archive.',
  })
  @IsOptional()
  @IsIn(EDITABLE_SHEET_STATUSES)
  status?: (typeof EDITABLE_SHEET_STATUSES)[number];
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
  norms?: string;

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

  @ApiPropertyOptional({
    description:
      'Criterion template it came from — required for every criterion when allowCustomCriteria is off',
  })
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

// Sent as multipart, with `file`: the signed fiche, as a PDF.
export class SignAnalysisSheetDto {
  @ApiProperty({ maxLength: 255 })
  @Trim()
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  signatoryName: string;

  @ApiProperty({ example: '2026-11-02' })
  @IsDateString({ strict: true })
  signedAt: string;
}

export class NewAnalysisVersionDto {
  @ApiPropertyOptional({ description: 'Why a new version is opened' })
  @IsOptional()
  @Trim()
  @IsString()
  @MaxLength(1000)
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
  contractId?: string;

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

  @ApiPropertyOptional({ enum: AnalysisSheetStatus })
  @IsOptional()
  @IsEnum(AnalysisSheetStatus)
  status?: AnalysisSheetStatus;
}

export class CreateCriterionTemplateDto {
  @ApiProperty({ example: 'Forme' })
  @IsString()
  @MaxLength(150)
  label: string;

  @ApiPropertyOptional({
    description:
      "The site whose fiches it serves. Left out: a common criterion (platform administrator), or the caller's site when they manage only one",
  })
  @IsOptional()
  @IsUUID('4')
  siteId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  description?: string;

  @ApiPropertyOptional({ default: 0 })
  @IsOptional()
  @IsInt()
  order?: number;

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @ApiPropertyOptional({
    default: true,
    description:
      'Put on every new element; otherwise offered, to be added by hand',
  })
  @IsOptional()
  @IsBoolean()
  appliedByDefault?: boolean;
}

// Its site never changes.
export class UpdateCriterionTemplateDto extends PartialType(
  OmitType(CreateCriterionTemplateDto, ['siteId'] as const),
) {}

export class FindCriteriaQueryDto {
  @ApiPropertyOptional({
    description:
      "The common criteria plus this site's — what a fiche of that site offers. Left out: the common ones plus the caller's site's (every site's for a platform administrator)",
  })
  @IsOptional()
  @IsUUID('4')
  siteId?: string;
}

export class AnalysisSettingsQueryDto {
  @ApiPropertyOptional({
    description:
      "This site's settings (its own, else the common ones). Left out: the common ones",
  })
  @IsOptional()
  @IsUUID('4')
  siteId?: string;
}

export class UpdateAnalysisSettingsDto {
  @ApiPropertyOptional({
    description:
      'Set the settings of this site only. Left out: the common ones (platform administrator)',
  })
  @IsOptional()
  @IsUUID('4')
  siteId?: string;

  @ApiProperty({
    description:
      'Whether an element may carry criteria outside the catalogue (PUT /analysis-sheets/items/:id/criteria)',
  })
  @IsBoolean()
  allowCustomCriteria: boolean;
}
