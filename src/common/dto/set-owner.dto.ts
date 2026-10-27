import { ApiProperty } from '@nestjs/swagger';
import { IsUUID } from 'class-validator';

// Shared shape for reassigning who is in charge of a Courrier or a
// Document — see MailService.setOwner / DocumentsService.setOwner.
export class SetOwnerDto {
  @ApiProperty()
  @IsUUID()
  ownerId: string;
}
