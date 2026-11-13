import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, Max, Min } from 'class-validator';

export const DEFAULT_TAKE = 20;

// Shared list query: same skip/take contract (and `{ data, total, skip,
// take }` response) as the dossier/deliverable/activity lists.
// The ceiling is 500, not 100: the frontend pickers load a whole list in
// one request (users take=500, referentials take=200).
export const MAX_TAKE = 500;
export class PaginationQueryDto {
  @ApiPropertyOptional({ description: 'Free-text search' })
  @IsOptional()
  @IsString()
  search?: string;

  @ApiPropertyOptional({ default: 0 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  skip?: number;

  @ApiPropertyOptional({ default: DEFAULT_TAKE, maximum: MAX_TAKE })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(MAX_TAKE)
  take?: number;
}
