import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';

export class CreateCircuitDto {
  @ApiProperty({ example: 'Validation courrier sortant standard' })
  @IsString()
  @MaxLength(150)
  name: string;

  @ApiPropertyOptional({
    description: 'DossierType id this circuit applies to',
  })
  @IsOptional()
  @IsUUID()
  dossierTypeId?: string;

  @ApiPropertyOptional({
    description: 'Role required to own/trigger this circuit',
  })
  @IsOptional()
  @IsUUID()
  roleId?: string;
}
