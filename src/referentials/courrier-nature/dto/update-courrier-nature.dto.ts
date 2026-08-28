import { PartialType } from '@nestjs/swagger';
import { CreateCourrierNatureDto } from './create-courrier-nature.dto';

export class UpdateCourrierNatureDto extends PartialType(
  CreateCourrierNatureDto,
) {}
