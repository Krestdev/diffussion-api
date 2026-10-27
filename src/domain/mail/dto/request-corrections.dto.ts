import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString } from 'class-validator';

export class RequestCorrectionsDto {
  @ApiProperty({ description: 'What has to be corrected' })
  @IsString()
  @IsNotEmpty()
  motif: string;
}
