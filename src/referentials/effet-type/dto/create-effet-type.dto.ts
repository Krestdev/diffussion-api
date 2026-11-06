import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsBoolean,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';

export class CreateEffetTypeDto {
  @ApiProperty({ example: 'Matière / spécimen' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  name: string;

  @ApiPropertyOptional({ example: 'Échantillon remis contre décharge' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;

  @ApiPropertyOptional({
    description:
      'Physical object: quantity, condition, packaging, location and return can be recorded',
    default: false,
  })
  @IsOptional()
  @IsBoolean()
  isPhysical?: boolean;

  @ApiPropertyOptional({
    description:
      'Can list the effets it accompanies, like a bordereau de transmission',
    default: false,
  })
  @IsOptional()
  @IsBoolean()
  canListEffets?: boolean;

  @ApiPropertyOptional({
    description: 'An inactive type is no longer offered for new effets',
    default: true,
  })
  @IsOptional()
  @IsBoolean()
  active?: boolean;

  @ApiPropertyOptional({
    description:
      "The site this type belongs to. A site's responsible may omit it (their own site is used) and can't pick another; omitted by a platform administrator: a global type, usable on every site.",
  })
  @IsOptional()
  @IsUUID('4')
  siteId?: string;
}
