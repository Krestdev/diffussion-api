import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsDateString,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';

export class CreateProjectDto {
  @ApiProperty({ example: 'Construction du Viaduc sur la Sanaga' })
  @IsString()
  @MaxLength(200)
  name: string;

  @ApiPropertyOptional({ example: 'PRJ-2026-07', description: 'Réf Projet' })
  @IsOptional()
  @IsString()
  @MaxLength(50)
  reference?: string;

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

  @ApiPropertyOptional({ description: 'Who answers for the project' })
  @IsOptional()
  @IsUUID()
  responsibleId?: string;

  @ApiPropertyOptional({ example: '2026-11-01' })
  @IsOptional()
  @IsDateString()
  startDate?: string;

  @ApiPropertyOptional({ example: '2028-06-30' })
  @IsOptional()
  @IsDateString()
  endDate?: string;
}
