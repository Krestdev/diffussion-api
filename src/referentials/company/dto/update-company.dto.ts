import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';

/**
 * What Diffusion decides about a company. A company is the CREAPP core's: it is created,
 * named, (de)activated and removed there (DirectorySyncService).
 */
export class UpdateCompanyDto {
  @ApiPropertyOptional({ example: 'Douala' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  city?: string;

  @ApiPropertyOptional({
    description:
      'Person responsible for this company ("Responsable de la société"): an active person of the company',
  })
  @IsOptional()
  @IsUUID()
  responsibleId?: string;
}
