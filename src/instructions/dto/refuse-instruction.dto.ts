import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsUUID } from 'class-validator';
import { DeclineSubscriptionDto } from './decline-subscription.dto';

// Body of the former PATCH :id/refuse, kept until the frontend moves to
// PATCH :id/ne-pas-souscrire. The executant no longer picks who takes over:
// `newAssigneeId` is still accepted, and ignored.
export class RefuseInstructionDto extends DeclineSubscriptionDto {
  @ApiPropertyOptional({
    deprecated: true,
    description: 'Ignored: the task goes back to its creator, who reassigns it',
  })
  @IsOptional()
  @IsUUID()
  newAssigneeId?: string;
}
