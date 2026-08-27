import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  ArrayUnique,
  IsArray,
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
  @ApiProperty({ example: 'Communauté urbaine de Douala' })
  @IsString()
  @MaxLength(200)
  title: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  description?: string;

  @ApiPropertyOptional({ description: 'DossierType id' })
  @IsOptional()
  @IsUUID()
  typeId?: string;

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

  @ApiPropertyOptional({ type: [String], example: ['subvention', 'communal'] })
  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @IsString({ each: true })
  keywords?: string[];
}
