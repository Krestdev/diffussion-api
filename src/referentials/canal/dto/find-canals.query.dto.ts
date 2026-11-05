import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsUUID } from 'class-validator';

export class FindCanalsQueryDto {
  @ApiPropertyOptional({
    description:
      "Only the canaux of this site (a platform administrator; anyone else only ever sees their own site's)",
  })
  @IsOptional()
  @IsUUID('4')
  siteId?: string;
}
