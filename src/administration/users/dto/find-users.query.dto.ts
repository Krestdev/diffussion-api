import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsDateString,
  IsEnum,
  IsOptional,
  IsUUID,
  Matches,
} from 'class-validator';
import { UserStatus } from '../../../generated/prisma/enums';
import { PaginationQueryDto } from '../../../common/dto/pagination.query.dto';

export class FindUsersQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: UserStatus })
  @IsOptional()
  @IsEnum(UserStatus)
  status?: UserStatus;

  @ApiPropertyOptional({
    description:
      'Only the users of this company. A company administrator only ever sees their own company.',
  })
  @IsOptional()
  @IsUUID('all')
  companyId?: string;

  @ApiPropertyOptional({ description: 'Only the holders of this role' })
  @IsOptional()
  @IsUUID('all')
  roleId?: string;

  @ApiPropertyOptional({
    description:
      'Only the people who have not signed in since this day (or never) — « Inactif depuis le »',
    example: '2026-10-16',
  })
  @IsOptional()
  @IsDateString()
  inactiveBefore?: string;

  @ApiPropertyOptional({
    description: 'Only the holders of a role granting this permission',
    example: 'incoming.dispatch',
  })
  @IsOptional()
  @Matches(/^[a-z][a-z0-9_.-]{1,49}$/)
  permission?: string;
}
