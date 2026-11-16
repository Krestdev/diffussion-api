import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  IsBoolean,
  IsDateString,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

/** « Accès et sécurité » (as EXPENZO's): the core's sign-ins and Diffusion's access changes. */
export class FindAccessFeedQueryDto {
  @ApiPropertyOptional({ description: 'Search in the event and the names' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  search?: string;

  @ApiPropertyOptional({
    description:
      "Only this company's events — within the companies the caller may audit (default: the caller's own)",
  })
  @IsOptional()
  @IsUUID('all')
  companyId?: string;

  @ApiPropertyOptional({ description: 'The person concerned' })
  @IsOptional()
  @IsUUID()
  userId?: string;

  @ApiPropertyOptional({
    description: 'The start of an address (« Adresse IP »)',
  })
  @IsOptional()
  @Matches(/^[0-9a-fA-F:.]{1,45}$/)
  ip?: string;

  @ApiPropertyOptional({
    description: 'Only wrong passwords and locks (« Connexions échouées »)',
  })
  @IsOptional()
  // A query string: only « true » turns it on.
  @Transform(
    ({ value }: { value: unknown }) => value === 'true' || value === true,
  )
  @IsBoolean()
  failed?: boolean;

  @ApiPropertyOptional({ example: '2026-11-01' })
  @IsOptional()
  @IsDateString()
  from?: string;

  @ApiPropertyOptional({
    description: 'Up to this day (included)',
    example: '2026-11-30',
  })
  @IsOptional()
  @IsDateString()
  to?: string;

  @ApiPropertyOptional({ default: 0 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  skip?: number;

  @ApiPropertyOptional({ default: 20 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  take?: number;
}

/** « Exporter le journal »: the export is itself written in the journal. */
export class AuditExportDto {
  @ApiProperty({ enum: ['XLSX', 'CSV', 'PDF'] })
  @IsIn(['XLSX', 'CSV', 'PDF'])
  format!: 'XLSX' | 'CSV' | 'PDF';

  @ApiProperty({ example: '2026-11-01' })
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  from!: string;

  @ApiProperty({ example: '2026-11-30' })
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  to!: string;

  @ApiProperty()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(10_000_000)
  count!: number;

  @ApiPropertyOptional({
    description: 'The filters applied, as the export shows them',
  })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  filters?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  details?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  fingerprint?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  maskIp?: boolean;
}
