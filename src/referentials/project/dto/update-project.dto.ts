import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsEnum,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';
import { ProjectContentType } from '../../../generated/prisma/client';

/**
 * Diffusion's own settings of a project (PATCH /projects/:id, project.update). Projects come from
 * the CREAPP core since 2026-11-23: their name, reference, description, responsible, dates and
 * status are changed in the core's console, never here.
 */
export class UpdateProjectDto {
  @ApiPropertyOptional({
    enum: ProjectContentType,
    description:
      'What the project holds: dossiers directly, or contracts (with their dossiers under them). Changes only when what it holds fits the new one',
  })
  @IsOptional()
  @IsEnum(ProjectContentType)
  contentType?: ProjectContentType;

  @ApiPropertyOptional({ example: 'Marché public' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  mode?: string;

  @ApiPropertyOptional({
    description: "Maître d'ouvrage — an active correspondent",
  })
  @IsOptional()
  @IsUUID()
  maitreOuvrageId?: string;

  @ApiPropertyOptional({
    example: 'Port Autonome de Douala',
    description:
      "Maître d'ouvrage by name, instead of maitreOuvrageId: the correspondent with that name, created if there is none yet",
  })
  @IsOptional()
  @IsString()
  @MaxLength(150)
  maitreOuvrageName?: string;
}
