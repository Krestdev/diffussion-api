import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsUUID } from 'class-validator';
import { PaginationQueryDto } from '../../../common/dto/pagination.query.dto';

export class FindRolesQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({
    description:
      'Only the roles of this site. Everyone only ever sees the global roles plus those of their own site.',
  })
  @IsOptional()
  @IsUUID('4')
  siteId?: string;
}
