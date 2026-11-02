import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsOptional } from 'class-validator';
import { ProjectStatus } from '../../../../generated/prisma/client';
import { PaginationQueryDto } from '../../../common/dto/pagination.query.dto';

// `search` (inherited) matches the project's name or reference.
export class FindProjectsQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: ProjectStatus })
  @IsOptional()
  @IsEnum(ProjectStatus)
  status?: ProjectStatus;
}
