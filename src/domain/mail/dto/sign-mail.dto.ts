import { ApiProperty } from '@nestjs/swagger';
import { IsDateString, IsUUID } from 'class-validator';

// Sent as multipart, with `file`: the signed scan.
export class SignMailDto {
  @ApiProperty({ format: 'uuid', description: 'Who signed it (active user)' })
  @IsUUID()
  signatoryId!: string;

  @ApiProperty({ example: '2026-11-02', description: 'Date of signature' })
  @IsDateString({ strict: true })
  signedAt!: string;
}
