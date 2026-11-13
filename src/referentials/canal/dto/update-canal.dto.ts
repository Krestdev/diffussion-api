import { OmitType, PartialType } from '@nestjs/swagger';
import { CreateCanalDto } from './create-canal.dto';

// Its site never changes: the effets that used it stay on theirs.
export class UpdateCanalDto extends PartialType(
  OmitType(CreateCanalDto, ['siteId'] as const),
) {}
