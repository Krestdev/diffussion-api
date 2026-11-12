import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';
import { EmptyToUndefined } from '../../../common/transforms/empty-to-undefined.transform';

// A sortant starts as a bare BROUILLON: only its subject is asked for, the
// rest (dossier included) is filled in later through PATCH /courriers/:id.
// Its reference is given right away, from its type's model.
export class CreateOutgoingMailDto {
  @ApiProperty({ example: 'Réponse à la demande d’information' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  subject: string;

  @ApiPropertyOptional({
    description:
      'Effet type (GET /effet-types): a global type or one of its site. Defaults to "Courrier". The reference is given at once from this type\'s model, so the type can no longer change afterwards.',
  })
  @IsOptional()
  @EmptyToUndefined()
  @IsUUID()
  typeId?: string;
}
