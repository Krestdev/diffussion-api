import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsBoolean,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';

// Only the label and its visibility can change: the code is the value every
// route checks.
export class UpdatePermissionDto {
  @ApiPropertyOptional({ example: 'Peut modifier les rôles' })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  description?: string;

  @ApiPropertyOptional({
    description: 'false: no longer listed in the role screens',
  })
  @IsOptional()
  @IsBoolean()
  display?: boolean;
}
