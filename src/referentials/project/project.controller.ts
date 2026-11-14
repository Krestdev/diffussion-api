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
import { CreateProjectDto } from './dto/create-project.dto';
import { FindProjectsQueryDto } from './dto/find-projects.query.dto';
import { SetReferentialAccessDto } from './dto/set-access.dto';
import { UpdateProjectDto } from './dto/update-project.dto';

@ApiTags('projects')
@ApiBearerAuth()
@UseGuards(CoreAuthGuard, PermissionsGuard)
@Controller('projects')
export class ProjectController {
  constructor(private readonly projectService: ProjectService) {}

  // project.create in the person's company —
  // checked in the service.
  @Post()
  @RequirePermissions(Permission.PROJECT_CREATE)
  create(@Body() dto: CreateProjectDto, @CurrentUser() user: AuthUser) {
    return this.projectService.create(dto, user.sub);
  }

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

  @Patch(':id')
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateProjectDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.projectService.update(id, dto, user.sub);
  }

  @Delete(':id')
  @RequirePermissions(Permission.PROJECT_ARCHIVE)
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthUser,
  ) {
    return this.projectService.remove(id, user.sub);
  }
}
