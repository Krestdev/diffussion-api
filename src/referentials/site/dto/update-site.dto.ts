import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';

/**
 * What Diffusion decides about a site. A site is a company of the CREAPP core: it is created,
 * named, (de)activated and removed there (DirectorySyncService).
 */
export class UpdateSiteDto {
  @ApiPropertyOptional({ example: 'Douala' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  city?: string;

  @ApiPropertyOptional({
    description:
      'Person responsible for this site ("Responsable du site"): an active person of the company',
  })
  @IsOptional()
  @IsUUID()
  responsibleId?: string;
}
