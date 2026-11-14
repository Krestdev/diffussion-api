import { OmitType, PartialType } from '@nestjs/swagger';
import { CreateCanalDto } from './create-canal.dto';

// Its company never changes: the effets that used it stay on theirs.
export class UpdateCanalDto extends PartialType(
  OmitType(CreateCanalDto, ['companyId'] as const),
) {}
