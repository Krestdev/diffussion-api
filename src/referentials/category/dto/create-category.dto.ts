import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsInt, IsOptional, IsString, Min, MaxLength } from 'class-validator';

export class CreateCategoryDto {
  @ApiProperty({ example: 'Correspondance administrative' })
  @IsString()
  @MaxLength(100)
  label: string;

  @ApiPropertyOptional({ example: 'CAT-01' })
  @IsOptional()
  @IsString()
  @MaxLength(30)
  code?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  description?: string;

  @ApiPropertyOptional({
    example: 60,
    description: 'RG-ARC-001: retention duration in months, inherited by dossiers of this category',
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  retentionMonths?: number;
}
