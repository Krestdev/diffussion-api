import { ApiProperty } from '@nestjs/swagger';
import { IsString, MinLength } from 'class-validator';

export class DeclineSubscriptionDto {
  // RG-INS-004: not subscribing must be motivated.
  @ApiProperty({ example: 'Charge de travail déjà pleine cette semaine' })
  @IsString()
  @MinLength(3)
  motif: string;
}
