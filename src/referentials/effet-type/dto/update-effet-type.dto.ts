import { OmitType, PartialType } from '@nestjs/swagger';
import { CreateEffetTypeDto } from './create-effet-type.dto';

// A type stays where it was made: global, or of its site.
export class UpdateEffetTypeDto extends PartialType(
  OmitType(CreateEffetTypeDto, ['siteId'] as const),
) {}
