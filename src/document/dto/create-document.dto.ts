import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsDateString,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';
import { DocumentCreateInput } from 'generated/prisma/models';
import { DocumentType, DocumentStatus } from 'generated/prisma/enums';

export class CreateDocumentDto implements DocumentCreateInput {
  @ApiProperty({ enum: DocumentType, example: DocumentType.COURRIER })
  @IsEnum(DocumentType)
  documentType: DocumentType;

  @ApiPropertyOptional({ example: 'Courrier' })
  @IsOptional()
  @IsString()
  @MaxLength(10)
  type?: string;

  @ApiPropertyOptional({ example: 'Brouillon' })
  @IsEnum(DocumentStatus)
  status: DocumentStatus;

  @ApiPropertyOptional({ example: 'Rapport annuel 2026' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  libelle?: string;

  @ApiPropertyOptional({ example: '2026-08-14T00:00:00.000Z' })
  @IsOptional()
  @IsDateString()
  date?: string;

  @ApiPropertyOptional({ example: 1 })
  @IsOptional()
  @IsInt()
  parentDocumentUuid?: number;

  @ApiPropertyOptional({ example: 1 })
  @IsOptional()
  @IsInt()
  categoryUuid?: number;

  @ApiPropertyOptional({ example: 1 })
  @IsOptional()
  @IsInt()
  correspondentUuid?: number;

  @ApiPropertyOptional({ example: 1 })
  @IsOptional()
  @IsInt()
  directory?: number;

  @ApiPropertyOptional({ example: 'MTP-2026-0447' })
  @IsOptional()
  @IsString()
  @MaxLength(30)
  reference?: string;

  @ApiPropertyOptional({ example: 'email' })
  @IsOptional()
  @IsString()
  @MaxLength(30)
  canal?: string;

  @ApiPropertyOptional({ example: 1 })
  @IsOptional()
  @IsInt()
  nombreExemplaires?: number;

  @ApiPropertyOptional({ example: 1 })
  @IsOptional()
  @IsInt()
  parentVersionUuid?: number;

  @ApiPropertyOptional({ example: 1 })
  @IsOptional()
  @IsInt()
  numeroVersion?: number;
}
