import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsUUID } from 'class-validator';

export class FindWorkloadQueryDto {
  @ApiPropertyOptional({ description: 'Only the agents of this site' })
  @IsOptional()
  @IsUUID()
  siteId?: string;
}
