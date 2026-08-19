import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsDateString,
  IsInt,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';

export class CreateDossierDto {
  @ApiPropertyOptional({ example: 'Étude technique' })
  @IsOptional()
  @IsString()
  @MaxLength(10)
  type?: string;

  @ApiPropertyOptional({ example: 'Subventions communales 2026' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  libelle?: string;

  @ApiPropertyOptional({ example: 1 })
  @IsOptional()
  @IsInt()
  categoryUuid?: number;

  @ApiPropertyOptional({ example: 1 })
  @IsOptional()
  @IsInt()
  correspondentUuid?: number;

  @ApiPropertyOptional({
    example: 2,
    description: 'Site that owns this dossier (RG-DOS-003)',
  })
  @IsOptional()
  @IsInt()
  siteUuid?: number;

  @ApiPropertyOptional({ example: 'Normale' })
  @IsOptional()
  @IsString()
  @MaxLength(20)
  priorite?: string;

  @ApiPropertyOptional({ example: '2026-08-14' })
  @IsOptional()
  @IsDateString()
  date?: string;
}
