import { ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { IsEnum, IsOptional, IsString, MaxLength } from 'class-validator';
import { ProjectStatus } from '../../../../generated/prisma/client';
import { CreateProjectDto } from './create-project.dto';

export class UpdateProjectDto extends PartialType(CreateProjectDto) {
  @ApiPropertyOptional({
    enum: ProjectStatus,
    description:
      'ACTIVE -> CLOSED -> ARCHIVED, and back one step at a time (CLOSED -> ACTIVE reopens, ARCHIVED -> CLOSED unarchives)',
  })
  @IsOptional()
  @IsEnum(ProjectStatus)
  status?: ProjectStatus;

  @ApiPropertyOptional({ description: 'Why the project is archived' })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  reason?: string;
}
