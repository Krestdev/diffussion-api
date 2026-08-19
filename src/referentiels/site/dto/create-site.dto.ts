import { ApiProperty } from '@nestjs/swagger';
import { IsString, MaxLength, IsEnum } from 'class-validator';
import { SiteStatus } from 'generated/prisma/enums';
import { SiteCreateInput } from 'generated/prisma/models';

export class CreateSiteDto implements SiteCreateInput {
  @ApiProperty({ example: 'Siège social' })
  @IsString()
  @MaxLength(100)
  name: string;

  @ApiProperty({ enum: SiteStatus })
  @IsEnum(SiteStatus)
  status: SiteStatus;
}
