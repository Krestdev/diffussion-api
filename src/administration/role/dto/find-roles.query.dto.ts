import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsBoolean, IsOptional, IsUUID } from 'class-validator';
import { PaginationQueryDto } from '../../../common/dto/pagination.query.dto';

export class FindRolesQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({
    description:
      'Kept for older clients: a role belongs to one company and everyone only sees the roles of their own company (another company gives an empty list).',
  })
  @IsOptional()
  @IsUUID('4')
  companyId?: string;

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
