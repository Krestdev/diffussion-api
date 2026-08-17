import { ApiProperty } from '@nestjs/swagger';
import { IsString, MinLength } from 'class-validator';

export class KeyQueryDto {
  @ApiProperty({ example: 'courriers/2026/08/uuid-scan.pdf' })
  @IsString()
  @MinLength(1)
  key: string;
}
