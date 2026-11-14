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
import { RestoreNoteDto } from '../../common/dto/restore-note.dto';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import { CoreAuthGuard } from '../../auth/guards/core-auth.guard';
import { PermissionsGuard } from '../../auth/access/permissions.guard';
import { Permission } from '../../auth/permissions';
import { RequirePermissions } from '../../auth/access/decorators';
import { AuthUser } from '../../auth/types/auth-user.type';
import { PaginationQueryDto } from '../../common/dto/pagination.query.dto';
import { SetReferentialAccessDto } from '../project/dto/set-access.dto';
import { ContractService } from './contract.service';
import { ArchiveReasonDto } from '../../common/dto/archive-reason.dto';
import { CreateContractDto } from './dto/create-contract.dto';
import { FindContractsQueryDto } from './dto/find-contracts.query.dto';
import { UpdateContractDto } from './dto/update-contract.dto';

// Readable by every user the contract is open to (dossier forms pick from
// it); managed like the other shared referentials, by platform
// administrators.
@ApiTags('contracts')
@ApiBearerAuth()
@UseGuards(CoreAuthGuard, PermissionsGuard)
@Controller('contracts')
export class ContractController {
  constructor(private readonly contractService: ContractService) {}

  // The permission in its project's company —
  // checked in the service (also for the routes below).
  @Post()
  @RequirePermissions(Permission.CONTRACT_CREATE)
  create(@Body() dto: CreateContractDto, @CurrentUser() user: AuthUser) {
    return this.contractService.create(dto, user.sub);
  }

  @Get()
  @RequirePermissions(Permission.CONTRACT_READ)
  findAll(
    @Query() query: FindContractsQueryDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.contractService.findAll(query, user.sub);
  }

  // Declared before ':id' so "types" isn't parsed as an id.
  @Get('types')
  @RequirePermissions(Permission.CONTRACT_READ)
  types() {
    return this.contractService.types();
  }

  // A contract restricted to others answers 404.
  @Get(':id')
  @RequirePermissions(Permission.CONTRACT_READ)
  findOne(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthUser,
  ) {
    return this.contractService.findOneFor(id, user.sub);
  }

  @Patch(':id')
  @RequirePermissions(Permission.CONTRACT_UPDATE)
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateContractDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.contractService.update(id, dto, user.sub);
  }

  @Post(':id/archive')
  @RequirePermissions(Permission.CONTRACT_ARCHIVE)
  archive(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ArchiveReasonDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.contractService.archive(id, user.sub, dto.reason);
  }

  @Post(':id/unarchive')
  @RequirePermissions(Permission.CONTRACT_ARCHIVE)
  unarchive(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: RestoreNoteDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.contractService.unarchive(id, user.sub, dto.note);
  }

  @Delete(':id')
  @RequirePermissions(Permission.CONTRACT_ARCHIVE)
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthUser,
  ) {
    return this.contractService.remove(id, user.sub);
  }

  @Get(':id/access')
  @RequirePermissions(Permission.CONTRACT_READ)
  getAccess(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthUser,
  ) {
    return this.contractService.getAccess(id, user.sub);
  }

  // The contract's responsible or an administrator of its company — checked in
  // the service.
  @Put(':id/access')
  setAccess(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SetReferentialAccessDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.contractService.setAccess(id, dto.userIds, user.sub);
  }

  @Get(':id/historique')
  @RequirePermissions(Permission.CONTRACT_READ)
  history(
    @Param('id', ParseUUIDPipe) id: string,
    @Query() query: PaginationQueryDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.contractService.history(id, user.sub, query);
  }
}
