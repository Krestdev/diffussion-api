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
import {
  DossierConfidentiality,
  DossierPriority,
} from 'generated/prisma/enums';

export class CreateDossierDto {
  @ApiPropertyOptional({
    example: 'DOS-2026-014',
    description:
      'The reference to give the dossier; generated (D-xxxxxx) when left out',
  })
  @IsOptional()
  @IsString()
  @MaxLength(30)
  number?: string;

  @ApiProperty({ example: 'Communauté urbaine de Douala' })
  @IsString()
  @MaxLength(200)
  title: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  description?: string;

  @ApiPropertyOptional({ description: 'Category id' })
  @IsOptional()
  @IsUUID()
  categoryId?: string;

  @ApiPropertyOptional({
    description: 'Optional wider project/programme this dossier belongs to',
  })
  @IsOptional()
  @IsUUID()
  projectId?: string;

  @ApiPropertyOptional({
    description:
      "The contract this dossier is carried out under. A contract's project is the dossier's project.",
  })
  @IsOptional()
  @IsUUID()
  contractId?: string;

  @ApiProperty({
    description: 'Owning site (RG-DOS-003 — exactly one, mandatory)',
  })
  @IsUUID()
  siteId: string;

  @ApiPropertyOptional({
    description:
      'Responsible user (RG-DOS-004). Defaults to the creator when omitted.',
  })
  @IsOptional()
  @IsUUID()
  responsibleId?: string;

  @ApiPropertyOptional({
    enum: DossierPriority,
    default: DossierPriority.NORMAL,
  })
  @IsOptional()
  @IsEnum(DossierPriority)
  priority?: DossierPriority;

  @ApiPropertyOptional({
    enum: DossierConfidentiality,
    default: DossierConfidentiality.PUBLIC,
  })
  @IsOptional()
  @IsEnum(DossierConfidentiality)
  confidentiality?: DossierConfidentiality;

  @ApiPropertyOptional({
    example: '2026-12-31',
    description: 'Target completion date — past it, the dossier turns LATE',
  })
  @IsOptional()
  @IsDateString()
  dueDate?: string;

  @ApiPropertyOptional({ type: [String], example: ['subvention', 'communal'] })
  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @IsString({ each: true })
  keywords?: string[];
}
