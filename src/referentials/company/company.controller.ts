import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiCookieAuth, ApiTags } from '@nestjs/swagger';
import { CoreAuthGuard } from '../../auth/guards/core-auth.guard';
import { PermissionGuard } from '../../auth/rbac/permission.guard';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import { AuthUser } from '../../auth/types/auth-user.type';
import { UpdateSiteDto } from './dto/update-site.dto';
import { FindSitesQueryDto } from './dto/find-sites.query.dto';
import { SiteService } from './site.service';

@ApiTags('sites')
@ApiCookieAuth('creapp_access')
@UseGuards(CoreAuthGuard, PermissionGuard)
// Sites are the core's companies: created, named, (de)activated and removed
// there (DirectorySyncService). Diffusion edits their city and responsible.
@Controller('sites')
export class SiteController {
  constructor(private readonly siteService: SiteService) {}

  @Get()
  findAll(@Query() query: FindSitesQueryDto, @CurrentUser() user: AuthUser) {
    return this.siteService.findAll(query, user.sub);
  }

  @Get(':uuid')
  findOne(
    @Param('uuid', ParseUUIDPipe) uuid: string,
    @CurrentUser() user: AuthUser,
  ) {
    return this.siteService.findVisible(uuid, user.sub);
  }

  // A platform administrator, or the site's responsible for their own site
  // — checked in SiteService.
  @Patch(':uuid')
  update(
    @Param('uuid', ParseUUIDPipe) uuid: string,
    @Body() dto: UpdateSiteDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.siteService.update(uuid, dto, user.sub);
  }
}
