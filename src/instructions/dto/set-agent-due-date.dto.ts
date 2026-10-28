import { ApiProperty } from '@nestjs/swagger';
import { IsDateString } from 'class-validator';

export class SetAgentDueDateDto {
  @ApiProperty({
    example: '2026-09-10',
    description:
      "The executants' deadline: livrables submitted by then. Not after the task's deadline.",
  })
  @IsDateString()
  agentDueDate: string;
}
