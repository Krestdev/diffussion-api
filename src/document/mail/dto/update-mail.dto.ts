import { PartialType, OmitType } from '@nestjs/swagger';
import { CreateMailDto } from './create-mail.dto';

// Direction cannot change after creation — it drives which state machine
// the courrier follows (RG-COU-002). ownerId is also excluded: it has its
// own dedicated endpoint/authorization (MailService.setOwner) since
// reassignment must stay possible outside the EDITABLE_STATUSES window this
// generic update() is restricted to.
export class UpdateMailDto extends PartialType(
  OmitType(CreateMailDto, ['direction', 'ownerId'] as const),
) {}
