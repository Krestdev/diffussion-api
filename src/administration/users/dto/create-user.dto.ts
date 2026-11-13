import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsEmail,
  IsEnum,
  IsOptional,
  IsString,
  IsUUID,
  MinLength,
} from 'class-validator';
import { AccessProfile, UserStatus } from '../../../../generated/prisma/client';
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

  @ApiPropertyOptional({
    enum: AccessProfile,
    default: AccessProfile.USER,
    description:
      'How the administration screens present the account (A·2). SUPER_ADMIN is set by a platform administrator only. The rights still come from the roles.',
  })
  @IsOptional()
  @IsEnum(AccessProfile)
  accessProfile?: AccessProfile;

  @ApiPropertyOptional({
    default: false,
    description:
      'The user has to change their password at their first login: until then, every route but POST /auth/change-password, GET /auth/me and POST /auth/logout answers 403.',
  })
  @IsOptional()
  @IsBoolean()
  mustChangePassword?: boolean;

  @ApiPropertyOptional({
    enum: UserStatus,
    default: UserStatus.ACTIVE,
    description: 'At creation only: afterwards, POST /users/:id/toggle-status.',
  })
  @IsOptional()
  @IsEnum(UserStatus)
  status?: UserStatus;
}
