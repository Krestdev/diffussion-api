import { ApiProperty } from '@nestjs/swagger';
import { IsString, MaxLength } from 'class-validator';

export class CreateCanalDto {
  @ApiProperty({ example: 'Courrier électronique' })
  @IsString()
  @MaxLength(100)
  name: string;
}
