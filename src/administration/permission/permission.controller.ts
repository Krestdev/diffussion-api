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
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import { CoreAuthGuard } from '../../auth/guards/core-auth.guard';
import { PermissionGuard } from '../../auth/rbac/permission.guard';
import { PermissionCode } from '../../auth/rbac/rbac.constants';
import {
  PlatformOnly,
  RequirePermission,
} from '../../auth/rbac/require-permission.decorator';
import { AuthUser } from '../../auth/types/auth-user.type';
import { CreatePermissionDto } from './dto/create-permission.dto';
import { UpdatePermissionDto } from './dto/update-permission.dto';
import { PermissionService } from './permission.service';

@ApiTags('permissions')
@ApiBearerAuth()
@UseGuards(CoreAuthGuard, PermissionGuard)
@Controller('permissions')
export class PermissionController {
  constructor(private readonly permissionService: PermissionService) {}

  // The catalogue itself: platform administrators only.
  @Post()
  @RequirePermission(PermissionCode.AdminManageRoles)
  @PlatformOnly()
  create(@Body() dto: CreatePermissionDto) {
    return this.permissionService.create(dto);
  }

  // Read by whoever builds roles — a site's responsible too, for their
  // site's roles (scope checked in PermissionService).
  @Get()
  findAll(@CurrentUser() user: AuthUser) {
    return this.permissionService.findAll(user.sub);
  }

  @Get(':id')
  findOne(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthUser,
  ) {
    return this.permissionService.findOne(id, user.sub);
  }

  @Patch(':id')
  @RequirePermission(PermissionCode.AdminManageRoles)
  @PlatformOnly()
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdatePermissionDto,
  ) {
    return this.permissionService.update(id, dto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermission(PermissionCode.AdminManageRoles)
  @PlatformOnly()
  remove(@Param('id', ParseUUIDPipe) id: string) {
    return this.permissionService.remove(id);
  }
}
