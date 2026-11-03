import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsDateString,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';
import { Trim } from '../../../common/transforms/trim.transform';

// A sent sortant: multipart with `file` (the discharged bordereau),
// `receivedBy` and `dischargedAt`, all required. An entrant: no body.
export class DischargeMailDto {
  @ApiPropertyOptional({
    maxLength: 255,
    description: 'Who received it and signed the bordereau (sortant)',
  })
  @IsOptional()
  @Trim()
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  receivedBy?: string;

  @ApiPropertyOptional({
    example: '2026-11-02',
    description: 'Date of the discharge (sortant)',
  })
  @IsOptional()
  @IsDateString({ strict: true })
  dischargedAt?: string;
}
