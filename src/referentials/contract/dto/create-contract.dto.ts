import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsArray,
  IsDateString,
  IsEnum,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
} from 'class-validator';
import { ContractType } from '../../../../generated/prisma/client';

export class CreateContractDto {
  @ApiProperty({ example: 'Travaux de réhabilitation du quai 12' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  title: string;

  @ApiPropertyOptional({
    example: 'MP-2026-041',
    description: "The contract's own reference, e.g. its marché number",
  })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  reference?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  description?: string;

  @ApiPropertyOptional({ enum: ContractType })
  @IsOptional()
  @IsEnum(ContractType)
  type?: ContractType;

  @ApiPropertyOptional({ example: 125000000, description: 'Montant' })
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  amount?: number;

  @ApiPropertyOptional({ example: '2026-10-15' })
  @IsOptional()
  @IsDateString()
  signedAt?: string;

  @ApiPropertyOptional({
    example: 'AO-2026-012',
    description: "Reference of the tender (appel d'offres)",
  })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  tenderReference?: string;

  @ApiPropertyOptional({ description: 'The client — an active correspondent' })
  @IsOptional()
  @IsUUID()
  clientId?: string;

  @ApiPropertyOptional({ description: 'Who answers for the contract' })
  @IsOptional()
  @IsUUID()
  responsibleId?: string;

  @ApiPropertyOptional({
    description:
      'The project this contract is part of. Its dossiers then belong to that project.',
  })
  @IsOptional()
  @IsUUID()
  projectId?: string;

  @ApiPropertyOptional({ example: '2026-11-01' })
  @IsOptional()
  @IsDateString()
  startDate?: string;

  @ApiPropertyOptional({ example: '2027-10-31' })
  @IsOptional()
  @IsDateString()
  endDate?: string;

  @ApiPropertyOptional({
    type: [String],
    description:
      'Users allowed to open the contract (creation only — then PUT /contracts/:id/access). None = everyone.',
  })
  @IsOptional()
  @IsArray()
  @IsUUID('all', { each: true })
  authorizedUserIds?: string[];
}
