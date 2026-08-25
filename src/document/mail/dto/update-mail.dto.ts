import { PartialType, OmitType } from '@nestjs/swagger';
import { CreateMailDto } from './create-mail.dto';

// Direction cannot change after creation — it drives which state machine
// the courrier follows (RG-COU-002).
export class UpdateMailDto extends PartialType(
  OmitType(CreateMailDto, ['direction'] as const),
) {}
