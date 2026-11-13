import { OmitType, PartialType } from '@nestjs/swagger';
import { CreateSiteDto } from './create-site.dto';

// Status changes go through toggle-status, which is reserved to platform
// administrators — a site administrator edits their site but can't
// deactivate it.
export class UpdateSiteDto extends PartialType(
  OmitType(CreateSiteDto, ['status'] as const),
) {}
