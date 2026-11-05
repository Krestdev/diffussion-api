import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsUUID } from 'class-validator';

export class ArchiveRoleDto {
  @ApiPropertyOptional({
    description:
      'Its holders receive this role instead (a global role, or one of the same site). Without it, they simply lose the archived role.',
  })
  @IsOptional()
  @IsUUID('4')
  reassignToRoleId?: string;
}
