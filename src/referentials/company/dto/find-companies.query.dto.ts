import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsOptional, IsString, IsUUID } from 'class-validator';
import { CompanyStatus } from 'generated/prisma/enums';
import { PaginationQueryDto } from '../../../common/dto/pagination.query.dto';

/**
 * Filters for GET /companies (the "Companies" admin table and the company pickers).
 * `search` (inherited) matches the company's name, code or city, or its
 * responsible's name.
 */
export class FindCompaniesQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: CompanyStatus })
  @IsOptional()
  @IsEnum(CompanyStatus)
  status?: CompanyStatus;

  @ApiPropertyOptional({ description: 'City, partial match' })
  @IsOptional()
  @IsString()
  city?: string;

  @ApiPropertyOptional({ description: 'Responsible (user id)' })
  @IsOptional()
  @IsUUID()
  responsibleId?: string;
}
