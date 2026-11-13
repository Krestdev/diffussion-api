import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsEmail,
  IsOptional,
  IsString,
  IsUUID,
  MinLength,
  ValidateIf,
} from 'class-validator';
import { NormalizeEmail } from '../../../common/transforms/normalize-email.transform';

export class CreateInvitationDto {
  @ApiProperty({ example: 'jean.mballa@creaconsult.com' })
  @IsEmail()
  @NormalizeEmail()
  email: string;

  @ApiProperty({ example: 'Jean MBALLA' })
  @IsString()
  @MinLength(2)
  name: string;

  @ApiPropertyOptional({
    nullable: true,
    description:
      'The site they will belong to. A site administrator may leave it out (their own site); null: a platform user',
  })
  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsUUID('4')
  siteId?: string | null;

  @ApiPropertyOptional({
    description: 'The role they will hold (global, or of that site)',
  })
  @IsOptional()
  @IsUUID('4')
  roleId?: string;
}

export class FindInvitationsQueryDto {
  @ApiPropertyOptional({ description: 'Only the invitations to this site' })
  @IsOptional()
  @IsUUID('4')
  siteId?: string;
}

export class AcceptInvitationDto {
  @ApiProperty({ description: 'Token from the invitation link' })
  @IsString()
  @MinLength(1)
  token: string;

  @ApiProperty({ example: 'N3wStr0ngP@ssword' })
  @IsString()
  @MinLength(8)
  password: string;
}
