import { ApiPropertyOptional } from '@nestjs/swagger';
import { ArrayUnique, IsArray, IsOptional, IsUUID } from 'class-validator';

export class AssignInstructionDto {
  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @IsUUID('4', { each: true })
  executantIds?: string[];

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  superviseurId?: string;
}
