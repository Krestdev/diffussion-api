import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { AppAdmin } from '../../auth/access/decorators';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import { AppAdminGuard } from '../../auth/guards/app-admin.guard';
import { AuthUser } from '../../auth/types/auth-user.type';
import { DirectorySyncService } from '../../core/directory-sync.service';
import { CreateRoleDto } from './dto/create-role.dto';
import { RenameRoleDto, SetPermissionsDto } from './dto/update-role.dto';
import { SetUserRolesDto, UserIdsDto } from './dto/user-roles.dto';
import {
  type PermissionCatalogView,
  type RoleDetail,
  RoleService,
  type RoleView,
  type UserRolesView,
} from './role.service';

/**
 * The app-admin API (as EXPENZO's): the core's console reads and edits Diffusion's roles and their
 * holders here, live, for one company (the token's). Only core-signed app-admin tokens are
 * accepted (AppAdminGuard); the core checked the administrator's right to manage the company.
 * Refusals carry the codes the console knows (ROLE_IN_USE, SYSTEM_ROLE_PROTECTED,
 * UNKNOWN_PERMISSION, UNIQUE_CONSTRAINT, ROLE_HAS_NO_DEFAULTS, NOT_FOUND, VALIDATION_FAILED).
 */
@ApiTags('app-admin')
@ApiBearerAuth()
@AppAdmin()
@UseGuards(AppAdminGuard)
@Controller('app-admin')
export class AppAdminController {
  constructor(
    private readonly roles: RoleService,
    private readonly directory: DirectorySyncService,
  ) {}

  @Get('permissions')
  permissions(): PermissionCatalogView {
    return this.roles.catalog();
  }

  @Get('roles')
  list(@CurrentUser() user: AuthUser): Promise<RoleView[]> {
    return this.roles.list(user.companyId);
  }

  @Get('roles/:id')
  get(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthUser,
  ): Promise<RoleDetail> {
    return this.roles.get(user.companyId, id);
  }

  @Post('roles')
  create(
    @Body() body: CreateRoleDto,
    @CurrentUser() user: AuthUser,
  ): Promise<RoleView> {
    return this.roles.create(user.companyId, body);
  }

  @Patch('roles/:id')
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: RenameRoleDto,
    @CurrentUser() user: AuthUser,
  ): Promise<RoleView> {
    return this.roles.update(user.companyId, id, body);
  }

  @Put('roles/:id/permissions')
  setPermissions(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: SetPermissionsDto,
    @CurrentUser() user: AuthUser,
  ): Promise<RoleView> {
    return this.roles.setPermissions(user.companyId, id, body.permissions);
  }

  /** A default role back to its default permissions. */
  @Post('roles/:id/restore')
  @HttpCode(HttpStatus.OK)
  restore(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthUser,
  ): Promise<RoleView> {
    return this.roles.restoreDefaults(user.companyId, id);
  }

  /** Diffusion never deletes a role (CDC G5): an unheld role is archived. */
  @Delete('roles/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthUser,
  ): Promise<void> {
    return this.roles.remove(user.companyId, id);
  }

  /** People's roles (the console's user list and user page). */
  @Post('users/roles')
  @HttpCode(HttpStatus.OK)
  userRoles(
    @Body() body: UserIdsDto,
    @CurrentUser() user: AuthUser,
  ): Promise<UserRolesView[]> {
    return this.roles.userRoles(user.companyId, body.userIds);
  }

  /** A person's roles; someone just invited is fetched from the directory first. */
  @Put('users/:id/roles')
  async setUserRoles(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: SetUserRolesDto,
    @CurrentUser() user: AuthUser,
  ): Promise<UserRolesView> {
    const known = await this.roles.userRoles(user.companyId, [id]);
    if (known.length === 0) await this.directory.syncSoon();
    return this.roles.setUserRoles(user.companyId, id, body.roleIds);
  }
}
