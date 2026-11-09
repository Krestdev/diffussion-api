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
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { PermissionGuard } from '../../auth/rbac/permission.guard';
import { PermissionCode } from '../../auth/rbac/rbac.constants';
import { RequirePermission } from '../../auth/rbac/require-permission.decorator';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import { JwtPayload } from '../../auth/types/jwt-payload.type';
import { PaginationQueryDto } from '../../common/dto/pagination.query.dto';
import { ProjectService } from './project.service';
import { CreateProjectDto } from './dto/create-project.dto';
import { FindProjectsQueryDto } from './dto/find-projects.query.dto';
import { SetReferentialAccessDto } from './dto/set-access.dto';
import { UpdateProjectDto } from './dto/update-project.dto';

@ApiTags('projects')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionGuard)
@Controller('projects')
export class ProjectController {
  constructor(private readonly projectService: ProjectService) {}

  // A site's responsible (their site's) or a platform administrator —
  // checked in the service.
  @Post()
  @RequirePermission(PermissionCode.ProjectCreate)
  create(@Body() dto: CreateProjectDto, @CurrentUser() user: JwtPayload) {
    return this.projectService.create(dto, user.sub);
  }

  @Get()
  @RequirePermission(PermissionCode.ProjectRead)
  findAll(
    @Query() query: FindProjectsQueryDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.projectService.findAll(query, user.sub);
  }

  // A project restricted to others answers 404.
  @Get(':id')
  @RequirePermission(PermissionCode.ProjectRead)
  findOne(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.projectService.findOneFor(id, user.sub);
  }

  @Get(':id/access')
  @RequirePermission(PermissionCode.ProjectRead)
  getAccess(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.projectService.getAccess(id, user.sub);
  }

  // The project's responsible or a platform administrator — checked in
  // the service.
  @Put(':id/access')
  setAccess(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SetReferentialAccessDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.projectService.setAccess(id, dto.userIds, user.sub);
  }

  @Get(':id/historique')
  @RequirePermission(PermissionCode.ProjectRead)
  history(
    @Param('id', ParseUUIDPipe) id: string,
    @Query() query: PaginationQueryDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.projectService.history(id, user.sub, query);
  }

  @Patch(':id')
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateProjectDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.projectService.update(id, dto, user.sub);
  }

  @Delete(':id')
  @RequirePermission(PermissionCode.ProjectArchive)
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.projectService.remove(id, user.sub);
  }
}
