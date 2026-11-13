import {
  ApiProperty,
  ApiPropertyOptional,
  OmitType,
  PartialType,
} from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { PaginationQueryDto } from './pagination.query.dto';
import {
  IsBoolean,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';

/**
 * An item of a site's reference list (PA·7): canal, correspondent type,
 * dossier type — a name unique within its site, a description, and whether
 * it is still offered (deactivated rather than deleted once used).
 */
export class CreateSiteListItemDto {
  @ApiProperty({ example: 'Administration publique' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  name: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;

  @ApiPropertyOptional({
    default: true,
    description: 'An inactive item is no longer offered for new records',
  })
  @IsOptional()
  @IsBoolean()
  active?: boolean;

  @ApiPropertyOptional({
    description:
      "The site it belongs to. Left out: the caller's site when they manage only one",
  })
  @IsOptional()
  @IsUUID('4')
  siteId?: string;
}

// Its site never changes.
export class UpdateSiteListItemDto extends PartialType(
  OmitType(CreateSiteListItemDto, ['siteId'] as const),
) {}

// The same skip / take / search as every list (PaginationQueryDto), and
// the same `{ data, total, skip, take }` response.
export class FindSiteListQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({
    description:
      "Only this site's (a platform administrator; anyone else only ever sees their own site's)",
  })
  @IsOptional()
  @IsUUID('4')
  siteId?: string;

  @ApiPropertyOptional({ description: 'true: the active ones only' })
  @IsOptional()
  @Transform(({ value }: { value: unknown }) =>
    value === 'true' ? true : value === 'false' ? false : value,
  )
  @IsBoolean()
  active?: boolean;
}
