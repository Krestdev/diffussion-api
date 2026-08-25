import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsDateString,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Min,
  MaxLength,
} from 'class-validator';
import { CourrierDirection } from 'generated/prisma/enums';

export class CreateMailDto {
  @ApiProperty()
  @IsUUID()
  dossierId: string;

  @ApiProperty({ enum: CourrierDirection })
  @IsEnum(CourrierDirection)
  direction: CourrierDirection;

  @ApiProperty({ example: 'Demande d’information sur le chantier' })
  @IsString()
  @MaxLength(255)
  subject: string;

  @ApiPropertyOptional({ description: 'Correspondent id' })
  @IsOptional()
  @IsUUID()
  correspondentId?: string;

  @ApiPropertyOptional({ description: 'CourrierNature id' })
  @IsOptional()
  @IsUUID()
  natureId?: string;

  @ApiPropertyOptional({ description: 'Canal id' })
  @IsOptional()
  @IsUUID()
  canalId?: string;

  @ApiPropertyOptional({
    description: 'Reference as printed on the physical courrier itself',
  })
  @IsOptional()
  @IsString()
  @MaxLength(60)
  reference?: string;

  @ApiPropertyOptional({ example: 1 })
  @IsOptional()
  @IsInt()
  @Min(1)
  copies?: number;

  @ApiPropertyOptional({ example: '2026-08-24T13:11:00.000Z' })
  @IsOptional()
  @IsDateString()
  receivedAt?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  scanUrl?: string;
}
