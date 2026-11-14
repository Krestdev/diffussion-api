import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsUUID } from 'class-validator';

export class ArchiveRoleDto {
  @ApiPropertyOptional({
    description:
      'Its holders receive this role instead (a role of the same company). Without it, they simply lose the archived role.',
  })
  @IsOptional()
  @IsUUID('4')
  reassignToRoleId?: string;
}
