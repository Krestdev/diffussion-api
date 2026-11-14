import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiCookieAuth, ApiTags } from '@nestjs/swagger';
import { RequirePermissions } from '../../auth/access/decorators';
import { PermissionsGuard } from '../../auth/access/permissions.guard';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import { CoreAuthGuard } from '../../auth/guards/core-auth.guard';
import { Permission } from '../../auth/permissions';
import { AuthUser } from '../../auth/types/auth-user.type';
import { RestoreNoteDto } from '../../common/dto/restore-note.dto';
import { ArchiveRoleDto } from './dto/archive-role.dto';
import { CreateRoleDto } from './dto/create-role.dto';
import { FindRolesQueryDto } from './dto/find-roles.query.dto';
import { UpdateRoleDto } from './dto/update-role.dto';
import { RoleService } from './role.service';

/**
 * The roles of the person's company, from Diffusion's administration (the core's console uses
 * the app-admin API). One only grants permissions one holds (CDC G4); roles are archived, never
 * deleted (G5).
 */
@ApiTags('roles')
@ApiCookieAuth('creapp_access')
@UseGuards(CoreAuthGuard, PermissionsGuard)
@Controller('roles')
export class RoleController {
  constructor(private readonly roles: RoleService) {}

  @Post()
  @RequirePermissions(Permission.ROLE_CREATE)
  create(@Body() dto: CreateRoleDto, @CurrentUser() user: AuthUser) {
    return this.roles.create(user.companyId, dto);
  }

  @Get()
  @RequirePermissions(Permission.ROLE_READ)
  findAll(@Query() query: FindRolesQueryDto, @CurrentUser() user: AuthUser) {
    if (query.companyId && query.companyId !== user.companyId) {
      return { data: [], total: 0, skip: query.skip ?? 0, take: query.take };
    }
    return this.roles.findAll(user.companyId, query);
  }

  @Get(':id')
  @RequirePermissions(Permission.ROLE_READ)
  findOne(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthUser,
  ) {
    return this.roles.get(user.companyId, id);
  }

  @Patch(':id')
  @RequirePermissions(Permission.ROLE_UPDATE)
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateRoleDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.roles.update(user.companyId, id, dto);
  }

  /** A default role back to its default permissions. */
  @Post(':id/restore-defaults')
  @RequirePermissions(Permission.ROLE_UPDATE)
  restoreDefaults(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthUser,
  ) {
    return this.roles.restoreDefaults(user.companyId, id);
  }

  // Never deleted: archived, then restorable from the Archives.
  @Post(':id/archive')
  @RequirePermissions(Permission.ROLE_ARCHIVE)
  archive(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ArchiveRoleDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.roles.archive(user.companyId, id, dto);
  }

  @Post(':id/restore')
  @RequirePermissions(Permission.ROLE_ARCHIVE)
  restore(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: RestoreNoteDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.roles.unarchive(user.companyId, id, dto.note);
  }
}
