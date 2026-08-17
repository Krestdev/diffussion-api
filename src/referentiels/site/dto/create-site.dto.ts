import { ApiProperty } from '@nestjs/swagger';
import { IsString, MaxLength } from 'class-validator';
import { SiteCreateInput } from 'generated/prisma/models';

export class CreateSiteDto implements SiteCreateInput {
  @ApiProperty({ example: 'Siège social' })
  @IsString()
  @MaxLength(100)
  nom: string;
}
