import { ApiProperty } from '@nestjs/swagger';
import { IsUUID } from 'class-validator';

// Shared shape for reassigning the circuit owner on a Courrier or a
// Document (10.6) — see MailService.setOwner / DocumentsService.setOwner.
export class SetOwnerDto {
  @ApiProperty()
  @IsUUID()
  ownerId: string;
}
