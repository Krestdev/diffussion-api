import { PartialType } from '@nestjs/swagger';
import { CreateCorrespondentDto } from './create-correspondent.dto';

export class UpdateCorrespondantDto extends PartialType(
  CreateCorrespondentDto,
) {}
