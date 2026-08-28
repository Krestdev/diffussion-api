import { PartialType } from '@nestjs/swagger';
import { CreateDossierTypeDto } from './create-dossier-type.dto';

export class UpdateDossierTypeDto extends PartialType(CreateDossierTypeDto) {}
