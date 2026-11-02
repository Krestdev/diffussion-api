import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';
import { EmptyToUndefined } from '../../common/transforms/empty-to-undefined.transform';

// Exactly one owner must be set — enforced in DocumentsService, since
// multipart form fields arrive as plain strings and a cross-field validator
// would add more ceremony than it's worth here.
export class UploadDocumentDto {
  @ApiPropertyOptional()
  @IsOptional()
  @EmptyToUndefined()
  @IsUUID()
  dossierId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @EmptyToUndefined()
  @IsUUID()
  courrierId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @EmptyToUndefined()
  @IsUUID()
  livrableId?: string;

  @ApiPropertyOptional({ description: "A contract's own documents" })
  @IsOptional()
  @EmptyToUndefined()
  @IsUUID()
  contractId?: string;

  @ApiPropertyOptional({
    description:
      'Person in charge of the document — also gets access to it. Can be ' +
      'left unset and completed later (see DocumentsService.setOwner).',
  })
  @IsOptional()
  @EmptyToUndefined()
  @IsUUID()
  ownerId?: string;

  @ApiPropertyOptional({
    description:
      'Human-readable display name for the document. ' +
      'If omitted, the original filename is used as the display name.',
    maxLength: 200,
  })
  @IsOptional()
  @EmptyToUndefined()
  @IsString()
  @MaxLength(200)
  name?: string;
}
