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
import { CoreAuthGuard } from '../../auth/guards/core-auth.guard';
import { PermissionsGuard } from '../../auth/access/permissions.guard';
import { Permission } from '../../auth/permissions';
import {
  RequirePermissions,
  SameCompany,
  fromBody,
  fromParam,
} from '../../auth/access/decorators';
import { AuthUser } from '../../auth/types/auth-user.type';
import { SetAccessDto } from '../../common/dto/access.dto';
import { PaginationQueryDto } from '../../common/dto/pagination.query.dto';
import { ArchiveReasonDto } from '../../common/dto/archive-reason.dto';
import { RestoreNoteDto } from '../../common/dto/restore-note.dto';
import { DossierService } from './dossier.service';
import { CreateDossierDto } from './dto/create-dossier.dto';
import { FindDossiersQueryDto } from './dto/find-dossiers.query.dto';
import { UpdateDossierDto } from './dto/update-dossier.dto';

@ApiTags('dossiers')
@ApiBearerAuth()
@UseGuards(CoreAuthGuard, PermissionsGuard)
// Permissions are checked at the company of the targeted resource.
@SameCompany(fromParam('dossier'))
@Controller('dossiers')
export class DossierController {
  constructor(private readonly dossierService: DossierService) {}

  @Get()
  @RequirePermissions(Permission.DOSSIER_READ)
  findAll(@Query() query: FindDossiersQueryDto, @CurrentUser() user: AuthUser) {
    return this.dossierService.findAll(query, user.sub);
  }

  @Post()
  @RequirePermissions(Permission.DOSSIER_CREATE)
  @SameCompany(fromBody('company', 'companyId'))
  create(@Body() dto: CreateDossierDto, @CurrentUser() user: AuthUser) {
    return this.dossierService.create(dto, user.sub);
  }

  @Get(':id')
  @RequirePermissions(Permission.DOSSIER_READ)
  findOne(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthUser,
  ) {
    return this.dossierService.detail(id, user.sub);
  }

  @Patch(':id')
  @RequirePermissions(Permission.DOSSIER_UPDATE)
  @SameCompany(fromParam('dossier'), fromBody('company', 'companyId'))
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateDossierDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.dossierService.update(id, dto, user.sub);
  }

  @Post(':id/close')
  @RequirePermissions(Permission.DOSSIER_CLOSE)
  close(@Param('id', ParseUUIDPipe) id: string) {
    return this.dossierService.close(id);
  }

  @Post(':id/reopen')
  @RequirePermissions(Permission.DOSSIER_REOPEN)
  reopen(@Param('id', ParseUUIDPipe) id: string) {
    return this.dossierService.reopen(id);
  }

  @Post(':id/archive')
  @RequirePermissions(Permission.DOSSIER_ARCHIVE)
  archive(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ArchiveReasonDto,
  ) {
    return this.dossierService.archive(id, dto.reason);
  }

  @Post(':id/unarchive')
  @RequirePermissions(Permission.DOSSIER_ARCHIVE)
  unarchive(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: RestoreNoteDto,
  ) {
    return this.dossierService.unarchive(id, dto.note);
  }

  @Get(':id/courriers')
  @RequirePermissions(Permission.DOSSIER_READ)
  getCourriers(
    @Param('id', ParseUUIDPipe) id: string,
    @Query() query: PaginationQueryDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.dossierService.getCourriers(id, query, user.sub);
  }

  @Get(':id/instructions')
  @RequirePermissions(Permission.DOSSIER_READ)
  getInstructions(
    @Param('id', ParseUUIDPipe) id: string,
    @Query() query: PaginationQueryDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.dossierService.getInstructions(id, query, user.sub);
  }

  @Get(':id/livrables')
  @RequirePermissions(Permission.DOSSIER_READ)
  getLivrables(
    @Param('id', ParseUUIDPipe) id: string,
    @Query() query: PaginationQueryDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.dossierService.getLivrables(id, query, user.sub);
  }

  @Get(':id/historique')
  @RequirePermissions(Permission.AUDIT_READ)
  getHistorique(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthUser,
  ) {
    return this.dossierService.getHistorique(id, user.sub);
  }

  @Get(':id/progression')
  @RequirePermissions(Permission.DOSSIER_READ)
  getProgression(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthUser,
  ) {
    return this.dossierService.getProgression(id, user.sub);
  }

  @Get(':id/access')
  @RequirePermissions(Permission.DOSSIER_READ)
  getAccess(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthUser,
  ) {
    return this.dossierService.getAccess(id, user.sub);
  }

  @Put(':id/access')
  @RequirePermissions(Permission.DOSSIER_UPDATE)
  setAccess(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SetAccessDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.dossierService.setAccess(id, dto, user.sub);
  }
}
