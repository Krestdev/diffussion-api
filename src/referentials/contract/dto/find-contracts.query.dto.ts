import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsEnum, IsInt, IsOptional, IsUUID, Max, Min } from 'class-validator';
import {
  ContractStatus,
  ContractType,
} from '../../../../generated/prisma/client';
import { PaginationQueryDto } from '../../../common/dto/pagination.query.dto';

// `search` (inherited) matches the contract's number, title or reference.
export class FindContractsQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ description: 'Only the contracts of this project' })
  @IsOptional()
  @IsUUID()
  projectId?: string;

  @ApiPropertyOptional({
    example: 60,
    description: 'Only the contracts ending between today and N days from now',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(3650)
  endingWithinDays?: number;

  @ApiPropertyOptional({ enum: ContractStatus })
  @IsOptional()
  @IsEnum(ContractStatus)
  status?: ContractStatus;

  @ApiPropertyOptional({ enum: ContractType })
  @IsOptional()
  @IsEnum(ContractType)
  type?: ContractType;
}
