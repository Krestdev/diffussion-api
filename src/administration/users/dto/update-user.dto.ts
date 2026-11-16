import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  ArrayUnique,
  IsArray,
  IsEnum,
  IsOptional,
  IsUUID,
} from 'class-validator';
import { AccessProfile } from '../../../generated/prisma/client';

/**
 * What Diffusion decides about a person: their roles and how the administration screens present
 * them. Name, email, phone, job title, status and company come from the CREAPP core
 * and are changed in its console.
 */
export class UpdateUserDto {
  @ApiPropertyOptional({
    type: [String],
    description:
      "Roles of the user's company (role.assign; never one's own, never a role with permissions one doesn't hold). Replaces the current set.",
  })
  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @IsUUID('all', { each: true })
  roleIds?: string[];

  @ApiPropertyOptional({
    enum: AccessProfile,
    description:
      'How the administration screens present the account (A·2). SUPER_ADMIN is set by a Diffusion super-administrator only. The rights still come from the roles.',
  })
  @IsOptional()
  @IsEnum(AccessProfile)
  accessProfile?: AccessProfile;
}
