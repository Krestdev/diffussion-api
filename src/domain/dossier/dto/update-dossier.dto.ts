import { OmitType, PartialType } from '@nestjs/swagger';
import { CreateDossierDto } from './create-dossier.dto';

// A dossier's number is fixed once created.
export class UpdateDossierDto extends PartialType(
  OmitType(CreateDossierDto, ['number'] as const),
) {}
