import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

// A sortant starts as a bare BROUILLON: only its subject is asked for, the
// rest (dossier included) is filled in later through PATCH /courriers/:id.
export class CreateOutgoingMailDto {
  @ApiProperty({ example: 'Réponse à la demande d’information' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  subject: string;
}
