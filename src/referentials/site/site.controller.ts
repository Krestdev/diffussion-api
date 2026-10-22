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
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { PermissionGuard } from '../../auth/rbac/permission.guard';
import { PermissionCode } from '../../auth/rbac/rbac.constants';
import {
  PlatformOnly,
  RequirePermission,
} from '../../auth/rbac/require-permission.decorator';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import { JwtPayload } from '../../auth/types/jwt-payload.type';
import { CreateSiteDto } from './dto/create-site.dto';
import { UpdateSiteDto } from './dto/update-site.dto';
import { FindSitesQueryDto } from './dto/find-sites.query.dto';
import { SiteService } from './site.service';

@ApiTags('sites')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionGuard)
@Controller('sites')
export class SiteController {
  constructor(private readonly siteService: SiteService) {}

  @Post()
  @RequirePermission(PermissionCode.AdminManageSites)
  @PlatformOnly()
  create(@Body() dto: CreateSiteDto) {
    return this.siteService.create(dto);
  }

  @Get()
  findAll(@Query() query: FindSitesQueryDto) {
    return this.siteService.findAll(query);
  }

  @Get(':uuid')
  findOne(@Param('uuid', ParseUUIDPipe) uuid: string) {
    return this.siteService.findOne(uuid);
  }

  // A platform administrator, or the site's responsible for their own site
  // — checked in SiteService.
  @Patch(':uuid')
  update(
    @Param('uuid', ParseUUIDPipe) uuid: string,
    @Body() dto: UpdateSiteDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.siteService.update(uuid, dto, user.sub);
  }

  @Post(':uuid/toggle-status')
  @RequirePermission(PermissionCode.AdminManageSites)
  @PlatformOnly()
  toggleStatus(@Param('uuid', ParseUUIDPipe) uuid: string) {
    return this.siteService.toggleStatus(uuid);
  }

  @Delete(':uuid')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermission(PermissionCode.AdminManageSites)
  @PlatformOnly()
  remove(@Param('uuid', ParseUUIDPipe) uuid: string) {
    return this.siteService.remove(uuid);
  }
}
