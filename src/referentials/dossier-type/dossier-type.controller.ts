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
import { DossierTypeService } from './dossier-type.service';
import { CreateDossierTypeDto } from './dto/create-dossier-type.dto';
import { UpdateDossierTypeDto } from './dto/update-dossier-type.dto';

@ApiTags('dossier-types')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionGuard)
@Controller('dossier-types')
export class DossierTypeController {
  constructor(private readonly dossierTypeService: DossierTypeService) {}

  @Post()
  @RequirePermission(PermissionCode.AdminManageReferentials)
  create(@Body() dto: CreateDossierTypeDto) {
    return this.dossierTypeService.create(dto);
  }

  @Get()
  findAll() {
    return this.dossierTypeService.findAll();
  }

  @Get(':id')
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.dossierTypeService.findOne(id);
  }

  @Patch(':id')
  @RequirePermission(PermissionCode.AdminManageReferentials)
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateDossierTypeDto,
  ) {
    return this.dossierTypeService.update(id, dto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermission(PermissionCode.AdminManageReferentials)
  remove(@Param('id', ParseUUIDPipe) id: string) {
    return this.dossierTypeService.remove(id);
  }
}
