import { ApiProperty } from '@nestjs/swagger';
import { IsString, MaxLength } from 'class-validator';

export class CreateProjectDto {
  @ApiProperty({ example: 'Construction du Viaduc sur la Sanaga' })
  @IsString()
  @MaxLength(200)
  name: string;
}
