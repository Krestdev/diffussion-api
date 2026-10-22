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
import { NormalizeEmail } from '../../../common/transforms/normalize-email.transform';

export class CreateUserDto {
  @ApiProperty({ example: 'Joseph FONKOU' })
  @IsString()
  @MinLength(2)
  name: string;

  @ApiProperty({ example: 'josephfonkou@creaconsult.com' })
  @IsEmail()
  @NormalizeEmail()
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

  @ApiPropertyOptional({
    type: String,
    nullable: true,
    description:
      "The user's site. A site administrator may omit it (their own site is used) and can't pick another. Null: platform user with global roles — super-admin only.",
  })
  @IsOptional()
  @IsUUID('4')
  siteId?: string | null;

  @ApiPropertyOptional({
    type: [String],
    description:
      "Roles held at the user's site (globally for a platform user).",
  })
  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @IsUUID('4', { each: true })
  roleIds?: string[];
}
