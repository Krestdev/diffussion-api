import { PartialType } from '@nestjs/swagger';
import { CreateDossierDto } from './create-deliverable.dto';

export class UpdateDossierDto extends PartialType(CreateDossierDto) {}
