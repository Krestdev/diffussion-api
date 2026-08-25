import { PartialType } from '@nestjs/swagger';
import { CreateCorrespondentTypeDto } from './create-correspondent-type.dto';

export class UpdateCorrespondentTypeDto extends PartialType(
  CreateCorrespondentTypeDto,
) {}
