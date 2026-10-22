import { SetMetadata } from '@nestjs/common';
import { PERMISSION_METADATA_KEY, PermissionCode } from './rbac.constants';

export const RequirePermission = (permission: PermissionCode) =>
  SetMetadata(PERMISSION_METADATA_KEY, permission);

export const PLATFORM_ONLY_METADATA_KEY = 'rbac:platform-only';

/**
 * The route's @RequirePermission only counts through a global grant, for a
 * permission that is otherwise usable at a site (e.g. a site administrator
 * edits their own site but can't create or delete sites). Permissions that
 * are always platform-wide are listed in PLATFORM_PERMISSIONS instead.
 */
export const PlatformOnly = () => SetMetadata(PLATFORM_ONLY_METADATA_KEY, true);
