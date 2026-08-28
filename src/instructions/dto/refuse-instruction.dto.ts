import { ApiProperty } from '@nestjs/swagger';
import { IsString, IsUUID, MinLength } from 'class-validator';

export class RefuseInstructionDto {
  // RG-INS-004: any refusal must be motivated.
  @ApiProperty({ example: 'Charge de travail déjà pleine cette semaine' })
  @IsString()
  @MinLength(3)
  motif: string;

  // Rejecting a task reassigns it in the same step — there's no separate
  // "unassigned, waiting for someone to pick it up" queue to fall back to.
  @ApiProperty({ description: 'Executant the task is reassigned to' })
  @IsUUID()
  newAssigneeId: string;
}
