import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  Min,
} from 'class-validator';
import { PermissionCode } from '../../../auth/rbac/rbac.constants';

/**
 * GET /users/directory — the people pickers (superviseur, agents,
 * validateur, auteur, signataire...), readable by every signed-in user.
 */
export class FindDirectoryQueryDto {
  @ApiPropertyOptional({
    description:
      "Only this site's people. Anyone but a platform administrator only ever gets their own site's.",
  })
  @IsOptional()
  @IsUUID('4')
  siteId?: string;

  @ApiPropertyOptional({ description: 'Name, email or function, partial' })
  @IsOptional()
  @IsString()
  search?: string;

  @ApiPropertyOptional({
    enum: PermissionCode,
    description:
      'Only those holding this permission at that site (or globally), e.g. INSTRUCTION_ASSIGN for a superviseur, ANALYSIS_DECIDE for a validateur',
  })
  @IsOptional()
  @IsEnum(PermissionCode)
  permission?: PermissionCode;

  @ApiPropertyOptional({
    type: String,
    description:
      'Comma-separated ids to resolve (names of people already chosen): returned whatever their site or status',
  })
  @IsOptional()
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string'
      ? value
          .split(',')
          .map((id) => id.trim())
          .filter(Boolean)
      : value,
  )
  @IsArray()
  @ArrayMaxSize(100)
  @IsUUID('4', { each: true })
  ids?: string[];

  @ApiPropertyOptional({ default: 200, maximum: 500 })
  @IsOptional()
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? parseInt(value, 10) : value,
  )
  @IsInt()
  @Min(1)
  @Max(500)
  take?: number;
}
