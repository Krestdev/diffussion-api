import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsOptional, IsString, IsUUID } from 'class-validator';
import { CorrespondentStatus } from 'generated/prisma/enums';
import { PaginationQueryDto } from '../../../common/dto/pagination.query.dto';

/**
 * Filters for GET /correspondents (the "Correspondants" admin table and the
 * correspondent pickers). `search` (inherited) matches the name, code,
 * email, phone or main contact. Pagination comes from PaginationQueryDto,
 * which also caps `take` at MAX_TAKE.
 */
export class FindCorrespondantsQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ description: 'CorrespondentType id' })
  @IsOptional()
  @IsUUID()
  typeId?: string;

  @ApiPropertyOptional({ description: 'City, partial match' })
  @IsOptional()
  @IsString()
  city?: string;

  @ApiPropertyOptional({ enum: CorrespondentStatus })
  @IsOptional()
  @IsEnum(CorrespondentStatus)
  status?: CorrespondentStatus;
}
