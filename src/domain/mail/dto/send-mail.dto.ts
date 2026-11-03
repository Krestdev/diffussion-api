import { ApiProperty } from '@nestjs/swagger';
import {
  IsDateString,
  IsNotEmpty,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';
import { Trim } from '../../../common/transforms/trim.transform';

export class SendMailDto {
  @ApiProperty({
    format: 'uuid',
    description:
      'Transmission mode (a canal); its name is kept as transmissionMode',
  })
  @IsUUID()
  canalId!: string;

  @ApiProperty({
    maxLength: 255,
    description: 'Whom it is handed to (kept as transmissionRecipient)',
  })
  @Trim()
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  recipient!: string;

  @ApiProperty({ example: '2026-11-02', description: 'Date of transmission' })
  @IsDateString({ strict: true })
  transmittedAt!: string;
}
