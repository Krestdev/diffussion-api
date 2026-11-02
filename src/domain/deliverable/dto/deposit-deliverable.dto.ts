import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength } from 'class-validator';

export class DepositDeliverableDto {
  @ApiPropertyOptional({
    description: "Agent's comment when depositing the livrable",
  })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  agentComment?: string;
}
