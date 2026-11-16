import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsOptional, IsString, IsUUID } from 'class-validator';
import { ProjectStatus } from '../../../generated/prisma/client';
import { PaginationQueryDto } from '../../../common/dto/pagination.query.dto';

// `search` (inherited) matches the project's name or reference.
export class FindProjectsQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: ProjectStatus })
  @IsOptional()
  @IsEnum(ProjectStatus)
  status?: ProjectStatus;

  @ApiPropertyOptional({
    example: 'ACTIVE,SUSPENDED',
    description:
      'Comma-separated statuses (a picker: the projects still offered, ACTIVE and SUSPENDED); ignored with `status`',
  })
  @IsOptional()
  @IsString()
  statuses?: string;

  @ApiPropertyOptional({
    description:
      "Only this company's projects (one only ever sees their own company's)",
  })
  @IsOptional()
  @IsUUID('all')
  companyId?: string;
}
