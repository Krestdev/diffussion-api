import { ApiProperty } from '@nestjs/swagger';
import { IsString, IsUUID, MaxLength } from 'class-validator';

export class CreateCanalDto {
  @ApiProperty({ example: 'Courrier électronique' })
  @IsString()
  @MaxLength(100)
  name: string;

  @ApiProperty({
    description:
      "The site it belongs to: only that site's effets use it (a name is unique within a site)",
  })
  @IsUUID('4')
  siteId: string;
}
