import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  Min,
} from 'class-validator';
import { ALL_PERMISSIONS, type Permission } from '../../../auth/permissions';

/**
 * GET /users/directory — the people pickers (superviseur, agents,
 * validateur, auteur, signataire...), readable by every signed-in user.
 */
export class FindDirectoryQueryDto {
  @ApiPropertyOptional({
    description:
      "Only this company's people: everyone only ever gets their own company's.",
  })
  @IsOptional()
  @IsUUID('4')
  companyId?: string;

  @ApiPropertyOptional({ description: 'Name, email or function, partial' })
  @IsOptional()
  @IsString()
  search?: string;

  @ApiPropertyOptional({
    enum: ALL_PERMISSIONS,
    description:
      'Only those holding this permission in their company (through a role or a delegation in force), e.g. instruction.assign for a superviseur, analysis.approve for a validateur',
  })
  @IsOptional()
  @IsIn(ALL_PERMISSIONS)
  permission?: Permission;

  @ApiPropertyOptional({
    type: String,
    description:
      'Comma-separated ids to resolve (names of people already chosen): returned whatever their company or status',
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
