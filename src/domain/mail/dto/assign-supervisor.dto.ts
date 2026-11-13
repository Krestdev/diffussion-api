import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsDateString, IsOptional, IsString, IsUUID } from 'class-validator';
import { EmptyToUndefined } from '../../../common/transforms/empty-to-undefined.transform';

export class AssignSupervisorDto {
  @ApiProperty({
    description: "ID de l'utilisateur désigné comme superviseur",
    format: 'uuid',
  })
  @IsUUID()
  supervisorId: string;

  @ApiPropertyOptional({
    description: 'Date limite fixée pour le superviseur (AAAA-MM-JJ)',
    example: '2026-11-15',
  })
  @IsOptional()
  @EmptyToUndefined()
  @IsDateString()
  dueDate?: string;

  @ApiPropertyOptional({
    description: 'Note ou consigne pour le superviseur',
    example: 'Prendre contact avec le maître d’ouvrage',
  })
  @IsOptional()
  @EmptyToUndefined()
  @IsString()
  note?: string;
}
