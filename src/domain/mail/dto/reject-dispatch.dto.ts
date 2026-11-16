import { ApiProperty } from '@nestjs/swagger';
import { IsString, MaxLength, MinLength } from 'class-validator';
import { Trim } from '../../../common/transforms/trim.transform';

/** « Rejeter le dispatching »: why the proposal is refused (sent to its proposer). */
export class RejectDispatchDto {
  @ApiProperty({
    minLength: 10,
    maxLength: 1000,
    description:
      'Why the proposed dispatching is rejected — told to whoever proposed it',
  })
  @Trim()
  @IsString()
  @MinLength(10)
  @MaxLength(1000)
  reason: string;
}
