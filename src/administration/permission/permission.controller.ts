import { Controller, Get, UseGuards } from '@nestjs/common';
import { ApiCookieAuth, ApiTags } from '@nestjs/swagger';
import { RequirePermissions } from '../../auth/access/decorators';
import { PermissionsGuard } from '../../auth/access/permissions.guard';
import { CoreAuthGuard } from '../../auth/guards/core-auth.guard';
import { Permission } from '../../auth/permissions';
import { type PermissionCatalogView, RoleService } from '../role/role.service';

/**
 * The permission catalogue (src/auth/permissions.ts), grouped, with en/fr/it labels and the
 * reads each action implies — the same answer as the app-admin API's. The catalogue is code:
 * permissions are no longer created, reworded or deleted at runtime.
 */
@ApiTags('permissions')
@ApiCookieAuth('creapp_access')
@UseGuards(CoreAuthGuard, PermissionsGuard)
@Controller('permissions')
export class PermissionController {
  constructor(private readonly roles: RoleService) {}

  @Get()
  @RequirePermissions(Permission.ROLE_READ)
  catalog(): PermissionCatalogView {
    return this.roles.catalog();
  }
}
