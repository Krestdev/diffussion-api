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
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { JwtPayload } from '../../auth/types/jwt-payload.type';
import { ArchiveRoleDto } from './dto/archive-role.dto';
import { CreateRoleDto } from './dto/create-role.dto';
import { FindRolesQueryDto } from './dto/find-roles.query.dto';
import { UpdateRoleDto } from './dto/update-role.dto';
import { RoleService } from './role.service';

@ApiTags('roles')
@ApiBearerAuth()
// Global roles: platform administrators. A site's roles: its responsible.
// Enforced in RoleService, since the responsible needs no role for it.
@UseGuards(JwtAuthGuard)
@Controller('roles')
export class RoleController {
  constructor(private readonly roleService: RoleService) {}

  @Post()
  create(@Body() dto: CreateRoleDto, @CurrentUser() user: JwtPayload) {
    return this.roleService.create(dto, user.sub);
  }

  @Get()
  findAll(@Query() query: FindRolesQueryDto, @CurrentUser() user: JwtPayload) {
    return this.roleService.findAll(query, user.sub);
  }

  @Get(':id')
  findOne(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.roleService.findOne(id, user.sub);
  }

  @Patch(':id')
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateRoleDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.roleService.update(id, dto, user.sub);
  }

  // Never deleted: archived, then restorable from the Archives.
  @Post(':id/archive')
  archive(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ArchiveRoleDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.roleService.archive(id, dto, user.sub);
  }

  @Post(':id/restore')
  restore(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.roleService.restore(id, user.sub);
  }
}
