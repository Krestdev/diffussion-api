import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsBoolean, IsOptional, IsUUID, Matches } from 'class-validator';

// Multipart fields come as strings.
const toBoolean = ({ value }: { value: unknown }) =>
  value === 'true' ? true : value === 'false' ? false : value;

/**
 * PATCH /settings/document-identity — multipart (with a `logo` file: PNG or
 * SVG, 2 MB at most) or JSON (colours only).
 */
export class UpdateDocumentIdentityDto {
  @ApiPropertyOptional({
    description:
      "This site's identity. Left out: the caller's site when they manage only one; the common one for a platform administrator",
  })
  @IsOptional()
  @IsUUID('4')
  siteId?: string;

  @ApiPropertyOptional({ example: '#7C3AED' })
  @IsOptional()
  @Matches(/^#[0-9A-Fa-f]{6}$/, { message: 'accentColor must be #RRGGBB' })
  accentColor?: string;

  @ApiPropertyOptional({
    description: "Use the module's own colour instead of accentColor",
  })
  @IsOptional()
  @Transform(toBoolean)
  @IsBoolean()
  useModuleColor?: boolean;

  @ApiPropertyOptional({ description: 'true: remove the current logo' })
  @IsOptional()
  @Transform(toBoolean)
  @IsBoolean()
  removeLogo?: boolean;

  @ApiPropertyOptional({
    description:
      'A site gives its own identity up, to inherit the common one again',
  })
  @IsOptional()
  @Transform(toBoolean)
  @IsBoolean()
  reset?: boolean;

  @ApiPropertyOptional({
    type: 'string',
    format: 'binary',
    description: 'PNG or SVG, 2 MB at most',
  })
  @IsOptional()
  logo?: unknown;
}
