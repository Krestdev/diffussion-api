import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  ArrayUnique,
  IsArray,
  IsEnum,
  IsOptional,
  IsUUID,
} from 'class-validator';
import { AccessProfile } from '../../../../generated/prisma/client';

/**
 * What Diffusion decides about a person: their roles and how the administration screens present
 * them. Name, email, phone, job title, status and company (their site) come from the CREAPP core
 * and are changed in its console.
 */
export class UpdateUserDto {
  @ApiPropertyOptional({
    type: [String],
    description:
      "Roles held at the user's site (globally for a platform user). Replaces the current set.",
  })
  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @IsUUID('4', { each: true })
  roleIds?: string[];

  @ApiPropertyOptional({
    enum: AccessProfile,
    description:
      'How the administration screens present the account (A·2). SUPER_ADMIN is set by a platform administrator only. The rights still come from the roles.',
  })
  @IsOptional()
  @IsEnum(AccessProfile)
  accessProfile?: AccessProfile;
}
