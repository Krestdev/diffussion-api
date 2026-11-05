import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsBoolean, IsOptional, IsUUID } from 'class-validator';
import { PaginationQueryDto } from '../../../common/dto/pagination.query.dto';

export class FindRolesQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({
    description:
      'Only the roles of this site. Everyone only ever sees the global roles plus those of their own site.',
  })
  @IsOptional()
  @IsUUID('4')
  siteId?: string;

  @ApiPropertyOptional({
    description:
      'true: the archived roles only (the Archives screen). Default: the roles in use.',
  })
  @IsOptional()
  @Transform(({ value }: { value: unknown }) =>
    value === 'true' ? true : value === 'false' ? false : value,
  )
  @IsBoolean()
  archived?: boolean;
}
