import { SetMetadata } from '@nestjs/common';
import { PERMISSION_METADATA_KEY, PermissionCode } from './rbac.constants';

export const RequirePermission = (permission: PermissionCode) =>
  SetMetadata(PERMISSION_METADATA_KEY, permission);
