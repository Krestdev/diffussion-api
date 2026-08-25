import { ApiProperty } from '@nestjs/swagger';
import { IsString, MaxLength } from 'class-validator';

export class CreateDossierTypeDto {
  @ApiProperty({ example: 'Étude technique' })
  @IsString()
  @MaxLength(100)
  name: string;
}
