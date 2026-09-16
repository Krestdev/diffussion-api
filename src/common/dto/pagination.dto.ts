import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, Min } from 'class-validator';

// Shared by every small "referential" list endpoint (roles, sites, dossier
// types, courrier natures, correspondent types, projects, categories,
// circuits, admin users) that used to return a bare array — now paginated
// so every table view can request one page at a time instead of the whole
// table. Endpoints with their own filters (courriers, dossiers,
// instructions, correspondents...) already carry skip/take inline on their
// own query DTO and don't need this.
export class PaginationQueryDto {
  @ApiPropertyOptional({ default: 0 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  skip?: number;

  @ApiPropertyOptional({ default: 20 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  take?: number;
}
