import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type, plainToInstance } from 'class-transformer';
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
  @ApiPropertyOptional({
    description:
      "Optional: whoever registers a courrier may not know its dossier. It then belongs to the registrant's site, and the dossier is attached later (PATCH /courriers/:id) — before it can be transmitted.",
  })
  @IsOptional()
  @EmptyToUndefined()
  @IsUUID()
  dossierId?: string;

  @ApiPropertyOptional({
    description: 'Optional project this courrier is attached to',
  })
  @IsOptional()
  @EmptyToUndefined()
  @IsUUID()
  projectId?: string;

  @ApiPropertyOptional({
    description: 'Optional contract this courrier is attached to',
  })
  @IsOptional()
  @EmptyToUndefined()
  @IsUUID()
  contractId?: string;

  @ApiPropertyOptional({
    description: 'Optional supervisor assigned to this courrier',
  })
  @IsOptional()
  @EmptyToUndefined()
  @IsUUID()
  supervisorId?: string;

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

  @ApiPropertyOptional({
    description:
      'Entrant only: transmit it to its dossier\'s responsible in the same request ("Voulez-vous transmettre ?"). Needs the dossier.',
    example: true,
  })
  @IsOptional()
  // Multipart forms send booleans as "true" / "false".
  @Transform(({ value }: { value: unknown }) =>
    value === 'true' ? true : value === 'false' || value === '' ? false : value,
  )
  @IsBoolean()
  transmit?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @EmptyToUndefined()
  @IsString()
  scanUrl?: string;

  @ApiPropertyOptional({
    description:
      'Effet type (GET /effet-types): a global type or one of its site. Defaults to "Courrier".',
  })
  @IsOptional()
  @EmptyToUndefined()
  @IsUUID()
  typeId?: string;

  @ApiPropertyOptional({
    description:
      'The bordereau de transmission this effet came with (an effet whose type can list effets).',
  })
  @IsOptional()
  @EmptyToUndefined()
  @IsUUID()
  parentId?: string;

  // Physical effets only (a type with isPhysical).
  @ApiPropertyOptional({ example: 3, description: 'Physical effets only' })
  @IsOptional()
  @EmptyToUndefined()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  quantity?: number;

  @ApiPropertyOptional({
    example: '3 carottes de béton, Ø 10 cm',
    description: 'Physical effets only',
  })
  @IsOptional()
  @EmptyToUndefined()
  @IsString()
  physicalDescription?: string;

  @ApiPropertyOptional({
    example: 'Emballage endommagé',
    description: 'Physical effets only: condition on receipt',
  })
  @IsOptional()
  @EmptyToUndefined()
  @IsString()
  @MaxLength(255)
  conditionOnReceipt?: string;

  @ApiPropertyOptional({
    example: 'Caisse scellée',
    description: 'Physical effets only',
  })
  @IsOptional()
  @EmptyToUndefined()
  @IsString()
  @MaxLength(255)
  packaging?: string;

  @ApiPropertyOptional({
    example: 'Armoire B2, salle des archives',
    description: 'Physical effets only: where it is kept',
  })
  @IsOptional()
  @EmptyToUndefined()
  @IsString()
  @MaxLength(255)
  storageLocation?: string;

  @ApiPropertyOptional({
    description:
      'Physical effets only: it has to be returned (POST /courriers/:id/return)',
  })
  @IsOptional()
  // Multipart forms send booleans as "true" / "false".
  @Transform(({ value }: { value: unknown }) =>
    value === 'true' ? true : value === 'false' || value === '' ? false : value,
  )
  @IsBoolean()
  returnExpected?: boolean;

  @ApiPropertyOptional({
    description:
      "Person in charge of the courrier — chosen freely among the application's " +
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
