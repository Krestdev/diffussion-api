import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type, plainToInstance } from 'class-transformer';
import {
  IsArray,
  IsDateString,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Min,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { CourrierDirection } from 'generated/prisma/enums';
import { EmptyToUndefined } from '../../../common/transforms/empty-to-undefined.transform';

export class CourrierDocumentDto {
  @ApiPropertyOptional({
    description:
      'Human-readable display name for the document. ' +
      'If omitted, defaults to the uploaded file original name.',
    maxLength: 200,
  })
  @IsOptional()
  @EmptyToUndefined()
  @IsString()
  @MaxLength(200)
  name?: string;
}

export class CreateMailDto {
  @ApiProperty()
  @IsUUID()
  dossierId: string;

  @ApiProperty({ enum: CourrierDirection })
  @IsEnum(CourrierDirection)
  direction: CourrierDirection;

  @ApiProperty({ example: 'Demande d’information sur le chantier' })
  @IsString()
  @MaxLength(255)
  subject: string;

  @ApiPropertyOptional({ description: 'Correspondent id' })
  @IsOptional()
  @EmptyToUndefined()
  @IsUUID()
  correspondentId?: string;

  @ApiPropertyOptional({ description: 'CourrierNature id' })
  @IsOptional()
  @EmptyToUndefined()
  @IsUUID()
  natureId?: string;

  @ApiPropertyOptional({ description: 'Canal id' })
  @IsOptional()
  @EmptyToUndefined()
  @IsUUID()
  canalId?: string;

  @ApiPropertyOptional({
    description: 'Reference as printed on the physical courrier itself',
  })
  @IsOptional()
  @EmptyToUndefined()
  @IsString()
  @MaxLength(60)
  reference?: string;

  @ApiPropertyOptional({ example: 1 })
  @IsOptional()
  @EmptyToUndefined()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  copies?: number;

  @ApiPropertyOptional({ example: '2026-08-24T13:11:00.000Z' })
  @IsOptional()
  @EmptyToUndefined()
  @IsDateString()
  receivedAt?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @EmptyToUndefined()
  @IsString()
  scanUrl?: string;

  @ApiPropertyOptional({
    description:
      "Circuit owner (10.6) — chosen freely among the application's " +
      'users at creation time. Can be left unset and completed later ' +
      '(see MailService.setOwner).',
  })
  @IsOptional()
  @EmptyToUndefined()
  @IsUUID()
  ownerId?: string;

  @ApiPropertyOptional({
    description: '"Répond à": the courrier (either direction) this one answers',
  })
  @IsOptional()
  @EmptyToUndefined()
  @IsUUID()
  respondsToId?: string;

  @ApiPropertyOptional({
    description:
      'Metadata for uploaded files in corresponding order: [{"name": "Piece 1"}, ...]. ' +
      'Can be passed as a JSON array or a JSON-encoded string.',
    type: [CourrierDocumentDto],
  })
  @IsOptional()
  @EmptyToUndefined()
  @Transform(({ value }) => {
    if (value === undefined || value === null) return undefined;
    let items = value;
    if (typeof value === 'string') {
      const trimmed = value.trim();
      if (!trimmed) return undefined;
      try {
        items = JSON.parse(trimmed);
      } catch {
        return value;
      }
    }
    if (Array.isArray(items)) {
      return plainToInstance(
        CourrierDocumentDto,
        items.map((item) => {
          if (typeof item === 'string') {
            try {
              return JSON.parse(item);
            } catch {
              return item;
            }
          }
          return item;
        }),
      );
    }
    if (typeof items === 'object') {
      return plainToInstance(CourrierDocumentDto, [items]);
    }
    return value;
  })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CourrierDocumentDto)
  documents?: CourrierDocumentDto[];
}

