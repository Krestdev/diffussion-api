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
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { PermissionGuard } from '../../auth/rbac/permission.guard';
import { PermissionCode } from '../../auth/rbac/rbac.constants';
import { RequirePermission } from '../../auth/rbac/require-permission.decorator';
import { CreateSiteDto } from './dto/create-site.dto';
import { UpdateSiteDto } from './dto/update-site.dto';
import { SiteService } from './site.service';

@ApiTags('sites')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionGuard)
@Controller('sites')
export class SiteController {
  constructor(private readonly siteService: SiteService) {}

  @Post()
  @RequirePermission(PermissionCode.AdminManageSites)
  create(@Body() dto: CreateSiteDto) {
    return this.siteService.create(dto);
  }

  @Get()
  findAll() {
    return this.siteService.findAll();
  }

  @Get(':uuid')
  findOne(@Param('uuid', ParseUUIDPipe) uuid: string) {
    return this.siteService.findOne(uuid);
  }

  @Patch(':uuid')
  @RequirePermission(PermissionCode.AdminManageSites)
  update(
    @Param('uuid', ParseUUIDPipe) uuid: string,
    @Body() dto: UpdateSiteDto,
  ) {
    return this.siteService.update(uuid, dto);
  }

  @Post(':uuid/toggle-status')
  @RequirePermission(PermissionCode.AdminManageSites)
  toggleStatus(@Param('uuid', ParseUUIDPipe) uuid: string) {
    return this.siteService.toggleStatus(uuid);
  }

  @Delete(':uuid')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermission(PermissionCode.AdminManageSites)
  remove(@Param('uuid', ParseUUIDPipe) uuid: string) {
    return this.siteService.remove(uuid);
  }
}
