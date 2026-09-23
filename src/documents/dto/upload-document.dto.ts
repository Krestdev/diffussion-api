import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsUUID } from 'class-validator';
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

  @ApiPropertyOptional({
    description:
      'Circuit owner (10.6) — can decide any step of a circuit started ' +
      'directly on this document, regardless of role/site gating. Can be ' +
      'left unset and completed later (see DocumentsService.setOwner).',
  })
  @IsOptional()
  @EmptyToUndefined()
  @IsUUID()
  ownerId?: string;
}
