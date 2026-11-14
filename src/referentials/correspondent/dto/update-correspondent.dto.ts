import { OmitType, PartialType } from '@nestjs/swagger';
import { CreateCorrespondentDto } from './create-correspondent.dto';

// Its company never changes: the effets that used it stay on theirs.
export class UpdateCorrespondantDto extends PartialType(
  OmitType(CreateCorrespondentDto, ['companyId'] as const),
) {}
