import { PartialType } from '@nestjs/swagger';
import { CreateCorrespondantDto } from './create-correspondant.dto';

export class UpdateCorrespondantDto extends PartialType(
  CreateCorrespondantDto,
) {}
