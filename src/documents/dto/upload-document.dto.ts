import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsUUID } from 'class-validator';

// Exactly one owner must be set — enforced in DocumentsService, since
// multipart form fields arrive as plain strings and a cross-field validator
// would add more ceremony than it's worth here.
export class UploadDocumentDto {
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
  livrableId?: string;
}
