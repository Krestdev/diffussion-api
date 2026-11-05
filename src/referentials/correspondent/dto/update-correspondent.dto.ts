import { OmitType, PartialType } from '@nestjs/swagger';
import { CreateCorrespondentDto } from './create-correspondent.dto';

// Its site never changes: the effets that used it stay on theirs.
export class UpdateCorrespondantDto extends PartialType(
  OmitType(CreateCorrespondentDto, ['siteId'] as const),
) {}
