import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { PermissionGuard } from '../../auth/rbac/permission.guard';
import { PermissionCode } from '../../auth/rbac/rbac.constants';
import { RequirePermission } from '../../auth/rbac/require-permission.decorator';
import { JwtPayloadWithRefreshToken } from '../../auth/types/jwt-payload.type';
import { SetAccessDto } from '../../common/dto/access.dto';
import { DossierService } from './dossier.service';
import { CreateDossierDto } from './dto/create-dossier.dto';
import { FindDossiersQueryDto } from './dto/find-dossiers.query.dto';
import { UpdateDossierDto } from './dto/update-dossier.dto';

@ApiTags('dossiers')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionGuard)
@Controller('dossiers')
export class DossierController {
  constructor(private readonly dossierService: DossierService) {}

  @Get()
  findAll(@Query() query: FindDossiersQueryDto) {
    return this.dossierService.findAll(query);
  }

  @Post()
  @RequirePermission(PermissionCode.DossierCreate)
  create(
    @Body() dto: CreateDossierDto,
    @CurrentUser() user: JwtPayloadWithRefreshToken,
  ) {
    return this.dossierService.create(dto, user.sub);
  }

  @Get(':id')
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.dossierService.findOne(id);
  }

  @Patch(':id')
  @RequirePermission(PermissionCode.DossierUpdate)
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateDossierDto,
  ) {
    return this.dossierService.update(id, dto);
  }

  @Post(':id/close')
  @RequirePermission(PermissionCode.DossierClose)
  close(@Param('id', ParseUUIDPipe) id: string) {
    return this.dossierService.close(id);
  }

  @Post(':id/reopen')
  @RequirePermission(PermissionCode.DossierReopen)
  reopen(@Param('id', ParseUUIDPipe) id: string) {
    return this.dossierService.reopen(id);
  }

  @Post(':id/archive')
  @RequirePermission(PermissionCode.DossierArchive)
  archive(@Param('id', ParseUUIDPipe) id: string) {
    return this.dossierService.archive(id);
  }

  @Post(':id/unarchive')
  @RequirePermission(PermissionCode.DossierArchive)
  unarchive(@Param('id', ParseUUIDPipe) id: string) {
    return this.dossierService.unarchive(id);
  }

  @Get(':id/courriers')
  getCourriers(@Param('id', ParseUUIDPipe) id: string) {
    return this.dossierService.getCourriers(id);
  }

  @Get(':id/instructions')
  getInstructions(@Param('id', ParseUUIDPipe) id: string) {
    return this.dossierService.getInstructions(id);
  }

  @Get(':id/livrables')
  getLivrables(@Param('id', ParseUUIDPipe) id: string) {
    return this.dossierService.getLivrables(id);
  }

  @Get(':id/historique')
  @RequirePermission(PermissionCode.AuditRead)
  getHistorique(@Param('id', ParseUUIDPipe) id: string) {
    return this.dossierService.getHistorique(id);
  }

  @Get(':id/progression')
  getProgression(@Param('id', ParseUUIDPipe) id: string) {
    return this.dossierService.getProgression(id);
  }

  @Get(':id/access')
  @RequirePermission(PermissionCode.DossierRead)
  getAccess(@Param('id', ParseUUIDPipe) id: string) {
    return this.dossierService.getAccess(id);
  }

  @Put(':id/access')
  @RequirePermission(PermissionCode.DossierUpdate)
  setAccess(@Param('id', ParseUUIDPipe) id: string, @Body() dto: SetAccessDto) {
    return this.dossierService.setAccess(id, dto);
  }
}
