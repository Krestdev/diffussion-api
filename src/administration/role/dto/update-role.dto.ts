import { OmitType, PartialType } from '@nestjs/swagger';
import { CreateRoleDto } from './create-role.dto';

// A role stays where it was made: global, or of its site.
export class UpdateRoleDto extends PartialType(
  OmitType(CreateRoleDto, ['siteId'] as const),
) {}
