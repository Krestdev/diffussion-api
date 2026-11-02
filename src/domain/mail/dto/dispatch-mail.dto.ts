import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsUUID } from 'class-validator';
import { EmptyToUndefined } from '../../../common/transforms/empty-to-undefined.transform';

export class DispatchMailDto {
  @ApiProperty({
    description: 'ID du projet de rattachement',
    format: 'uuid',
  })
  @IsUUID()
  projectId: string;

  @ApiPropertyOptional({
    description:
      'ID du contrat du projet (exactement un parmi contractId et dossierId)',
    format: 'uuid',
  })
  @IsOptional()
  @EmptyToUndefined()
  @IsUUID()
  contractId?: string;

  @ApiPropertyOptional({
    description:
      'ID du dossier du projet (exactement un parmi contractId et dossierId)',
    format: 'uuid',
  })
  @IsOptional()
  @EmptyToUndefined()
  @IsUUID()
  dossierId?: string;
}
