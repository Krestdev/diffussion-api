import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CoreAuthGuard } from '../../auth/guards/core-auth.guard';
import { PermissionsGuard } from '../../auth/access/permissions.guard';
import { Permission } from '../../auth/permissions';
import { RequirePermissions } from '../../auth/access/decorators';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import { AuthUser } from '../../auth/types/auth-user.type';
import { PaginationQueryDto } from '../../common/dto/pagination.query.dto';
import { ProjectService } from './project.service';
import { FindProjectsQueryDto } from './dto/find-projects.query.dto';
import { SetReferentialAccessDto } from './dto/set-access.dto';
import { UpdateProjectDto } from './dto/update-project.dto';

/**
 * Projects, read-only copies of the CREAPP core's (owner, 2026-11-23, as EXPENZO): creating,
 * editing, suspending, closing, archiving and deleting them happen in the core's console
 * (/admin/projects); POST /projects, DELETE /projects/:id and status changes are withdrawn.
 * PATCH sets Diffusion's own settings of a project only (what it holds, mode, maître d'ouvrage).
 */
@ApiTags('projects')
@ApiBearerAuth()
@UseGuards(CoreAuthGuard, PermissionsGuard)
@Controller('projects')
export class ProjectController {
  constructor(private readonly projectService: ProjectService) {}

  @Get()
  @RequirePermissions(Permission.PROJECT_READ)
  findAll(@Query() query: FindProjectsQueryDto, @CurrentUser() user: AuthUser) {
    return this.projectService.findAll(query, user.sub);
  }

  // A project restricted to others answers 404.
  @Get(':id')
  @RequirePermissions(Permission.PROJECT_READ)
  findOne(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthUser,
  ) {
    return this.projectService.findOneFor(id, user.sub);
  }

  @Get(':id/access')
  @RequirePermissions(Permission.PROJECT_READ)
  getAccess(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthUser,
  ) {
    return this.projectService.getAccess(id, user.sub);
  }

  // The project's responsible or an administrator of its company — checked in
  // the service.
  @Put(':id/access')
  setAccess(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SetReferentialAccessDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.projectService.setAccess(id, dto.userIds, user.sub);
  }

  @Get(':id/historique')
  @RequirePermissions(Permission.PROJECT_READ)
  history(
    @Param('id', ParseUUIDPipe) id: string,
    @Query() query: PaginationQueryDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.projectService.history(id, user.sub, query);
  }

  // project.update in the project's company — checked in the service.
  @Patch(':id')
  @RequirePermissions(Permission.PROJECT_UPDATE)
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateProjectDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.projectService.update(id, dto, user.sub);
  }
}
