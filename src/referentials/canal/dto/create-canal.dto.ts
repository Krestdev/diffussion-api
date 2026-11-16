import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsBoolean,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';

export class CreateCanalDto {
  @ApiProperty({ example: 'Courrier électronique' })
  @IsString()
  @MaxLength(100)
  name: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;

  @ApiPropertyOptional({
    default: true,
    description:
      'An inactive canal is no longer offered for new effets (deactivated rather than deleted)',
  })
  @IsOptional()
  @IsBoolean()
  active?: boolean;

  @ApiProperty({
    description:
      "The company it belongs to: only that company's effets use it (a name is unique within a company)",
  })
  @IsUUID('all')
  companyId: string;
}
