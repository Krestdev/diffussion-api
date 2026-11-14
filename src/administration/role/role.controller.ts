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
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { RestoreNoteDto } from '../../common/dto/restore-note.dto';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import { CoreAuthGuard } from '../../auth/guards/core-auth.guard';
import { PermissionGuard } from '../../auth/rbac/permission.guard';
import { PermissionCode } from '../../auth/rbac/rbac.constants';
import { RequirePermission } from '../../auth/rbac/require-permission.decorator';
import { AuthUser } from '../../auth/types/auth-user.type';
import { ArchiveRoleDto } from './dto/archive-role.dto';
import { CreateRoleDto } from './dto/create-role.dto';
import { FindRolesQueryDto } from './dto/find-roles.query.dto';
import { UpdateRoleDto } from './dto/update-role.dto';
import { RoleService } from './role.service';

@ApiTags('roles')
@ApiBearerAuth()
// Global roles: platform administrators. A site's roles: its responsible.
// Enforced in RoleService, since the responsible needs no role for it.
@UseGuards(CoreAuthGuard, PermissionGuard)
@Controller('roles')
export class RoleController {
  constructor(private readonly roleService: RoleService) {}

  @Post()
  create(@Body() dto: CreateRoleDto, @CurrentUser() user: AuthUser) {
    return this.roleService.create(dto, user.sub);
  }

  @Get()
  @RequirePermission(PermissionCode.RolesRead)
  findAll(@Query() query: FindRolesQueryDto, @CurrentUser() user: AuthUser) {
    return this.roleService.findAll(query, user.sub);
  }

  @Get(':id')
  @RequirePermission(PermissionCode.RolesRead)
  findOne(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthUser,
  ) {
    return this.roleService.findOne(id, user.sub);
  }

  @Patch(':id')
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateRoleDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.roleService.update(id, dto, user.sub);
  }

  // Never deleted: archived, then restorable from the Archives.
  @Post(':id/archive')
  archive(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ArchiveRoleDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.roleService.archive(id, dto, user.sub);
  }

  @Post(':id/restore')
  restore(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: RestoreNoteDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.roleService.restore(id, user.sub, dto.note);
  }
}
