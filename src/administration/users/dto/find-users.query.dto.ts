import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsOptional, IsUUID } from 'class-validator';
import { UserStatus } from '../../../../generated/prisma/enums';
import { PaginationQueryDto } from '../../../common/dto/pagination.query.dto';

export class FindUsersQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: UserStatus })
  @IsOptional()
  @IsEnum(UserStatus)
  status?: UserStatus;

  @ApiPropertyOptional({
    description:
      'Only the users of this site. A site administrator only ever sees their own site.',
  })
  @IsOptional()
  @IsUUID('4')
  siteId?: string;
}
