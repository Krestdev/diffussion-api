import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsOptional, IsString, IsUUID } from 'class-validator';
import { SiteStatus } from 'generated/prisma/enums';
import { PaginationQueryDto } from '../../../common/dto/pagination.query.dto';

/**
 * Filters for GET /sites (the "Sites" admin table and the site pickers).
 * `search` (inherited) matches the site's name, code or city, or its
 * responsible's name.
 */
export class FindSitesQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: SiteStatus })
  @IsOptional()
  @IsEnum(SiteStatus)
  status?: SiteStatus;

  @ApiPropertyOptional({ description: 'City, partial match' })
  @IsOptional()
  @IsString()
  city?: string;

  @ApiPropertyOptional({ description: 'Responsible (user id)' })
  @IsOptional()
  @IsUUID()
  responsibleId?: string;
}
