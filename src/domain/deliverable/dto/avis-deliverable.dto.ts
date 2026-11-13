import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString, MaxLength } from 'class-validator';
import { Trim } from '../../../common/transforms/trim.transform';

export class AvisDeliverableDto {
  @ApiProperty({
    example: 'Conforme au cahier des charges, à part la section 3.',
    description: "The validateur's opinion — the superviseur decides after it",
  })
  @Trim()
  @IsString()
  @IsNotEmpty()
  @MaxLength(4000)
  comment: string;
}
