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
import {
  JwtPayload,
  JwtPayloadWithRefreshToken,
} from '../../auth/types/jwt-payload.type';
import { SetAccessDto } from '../../common/dto/access.dto';
import { PaginationQueryDto } from '../../common/dto/pagination.query.dto';
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
  @RequirePermission(PermissionCode.DossierRead)
  findAll(
    @Query() query: FindDossiersQueryDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.dossierService.findAll(query, user.sub);
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
  @RequirePermission(PermissionCode.DossierRead)
  findOne(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.dossierService.findOne(id, user.sub);
  }

  @Patch(':id')
  @RequirePermission(PermissionCode.DossierUpdate)
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateDossierDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.dossierService.update(id, dto, user.sub);
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
  @RequirePermission(PermissionCode.DossierRead)
  getCourriers(
    @Param('id', ParseUUIDPipe) id: string,
    @Query() query: PaginationQueryDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.dossierService.getCourriers(id, query, user.sub);
  }

  @Get(':id/instructions')
  @RequirePermission(PermissionCode.DossierRead)
  getInstructions(
    @Param('id', ParseUUIDPipe) id: string,
    @Query() query: PaginationQueryDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.dossierService.getInstructions(id, query, user.sub);
  }

  @Get(':id/livrables')
  @RequirePermission(PermissionCode.DossierRead)
  getLivrables(
    @Param('id', ParseUUIDPipe) id: string,
    @Query() query: PaginationQueryDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.dossierService.getLivrables(id, query, user.sub);
  }

  @Get(':id/historique')
  @RequirePermission(PermissionCode.AuditRead)
  getHistorique(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.dossierService.getHistorique(id, user.sub);
  }

  @Get(':id/progression')
  @RequirePermission(PermissionCode.DossierRead)
  getProgression(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.dossierService.getProgression(id, user.sub);
  }

  @Get(':id/access')
  @RequirePermission(PermissionCode.DossierRead)
  getAccess(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.dossierService.getAccess(id, user.sub);
  }

  @Put(':id/access')
  @RequirePermission(PermissionCode.DossierUpdate)
  setAccess(@Param('id', ParseUUIDPipe) id: string, @Body() dto: SetAccessDto) {
    return this.dossierService.setAccess(id, dto);
  }
}
