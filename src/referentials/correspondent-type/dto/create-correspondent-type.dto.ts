import { ApiProperty } from '@nestjs/swagger';
import { IsString, MaxLength } from 'class-validator';

export class CreateCorrespondentTypeDto {
  @ApiProperty({ example: 'Administration publique' })
  @IsString()
  @MaxLength(100)
  name: string;
}
