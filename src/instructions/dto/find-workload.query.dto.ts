import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsUUID } from 'class-validator';

export class FindWorkloadQueryDto {
  @ApiPropertyOptional({ description: 'Only the agents of this company' })
  @IsOptional()
  @IsUUID()
  companyId?: string;
}
