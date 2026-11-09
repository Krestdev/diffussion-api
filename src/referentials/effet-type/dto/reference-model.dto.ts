import { ApiProperty } from '@nestjs/swagger';
import {
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsIn,
  Matches,
  MaxLength,
} from 'class-validator';
import {
  REFERENCE_CODES,
  REFERENCE_COUNTER_DIGITS,
  REFERENCE_COUNTER_RESETS,
  REFERENCE_SEPARATORS,
  REFERENCE_YEAR_DIGITS,
  type ReferenceModel,
} from '../reference-model';

export class ReferenceModelDto implements ReferenceModel {
  @ApiProperty({ example: 'LET', description: 'A-Z and 0-9 only' })
  @Matches(/^[A-Z0-9]+$/, {
    message: 'prefix must only contain A-Z and 0-9',
  })
  @MaxLength(10)
  prefix: string;

  @ApiProperty({ enum: REFERENCE_SEPARATORS })
  @IsIn(REFERENCE_SEPARATORS)
  separator: ReferenceModel['separator'];

  @ApiProperty({ enum: REFERENCE_COUNTER_DIGITS })
  @IsIn(REFERENCE_COUNTER_DIGITS)
  counterDigits: ReferenceModel['counterDigits'];

  @ApiProperty({ enum: REFERENCE_COUNTER_RESETS })
  @IsIn(REFERENCE_COUNTER_RESETS)
  counterReset: ReferenceModel['counterReset'];

  @ApiProperty({
    enum: REFERENCE_YEAR_DIGITS,
    description: '0: no year in the reference',
  })
  @IsIn(REFERENCE_YEAR_DIGITS)
  yearDigits: ReferenceModel['yearDigits'];

  @ApiProperty()
  @IsBoolean()
  monthIncluded: boolean;

  @ApiProperty({
    enum: REFERENCE_CODES,
    isArray: true,
    description: 'Printed in this order, between the prefix and the year',
  })
  @IsArray()
  @ArrayUnique()
  @IsIn(REFERENCE_CODES, {
    each: true,
    message: `codes must be among: ${REFERENCE_CODES.join(', ')} (SERVICE n'est pas encore disponible)`,
  })
  codes: ReferenceModel['codes'];
}
