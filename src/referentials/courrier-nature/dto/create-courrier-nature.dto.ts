import { ApiProperty } from '@nestjs/swagger';
import { IsString, MaxLength } from 'class-validator';

export class CreateCourrierNatureDto {
  @ApiProperty({ example: 'Demande d’information' })
  @IsString()
  @MaxLength(100)
  name: string;
}
