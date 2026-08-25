import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  ArrayUnique,
  IsArray,
  IsEmail,
  IsOptional,
  IsString,
  IsUUID,
  MinLength,
} from 'class-validator';

export class CreateUserDto {
  @ApiProperty({ example: 'Joseph FONKOU' })
  @IsString()
  @MinLength(2)
  name: string;

  @ApiProperty({ example: 'josephfonkou@creaconsult.com' })
  @IsEmail()
  email: string;

  @ApiProperty({ example: 'Str0ngP@ssword' })
  @IsString()
  @MinLength(8)
  password: string;

  @ApiPropertyOptional({ example: 'Comptable' })
  @IsOptional()
  @IsString()
  function?: string;

  @ApiPropertyOptional({ example: '+237690000000' })
  @IsOptional()
  @IsString()
  phone?: string;

  @ApiPropertyOptional({ type: [String], description: 'Role ids' })
  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @IsUUID('4', { each: true })
  roleIds?: string[];

  @ApiPropertyOptional({ type: [String], description: 'Site ids' })
  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @IsUUID('4', { each: true })
  siteIds?: string[];
}
