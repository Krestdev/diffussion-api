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
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { PermissionGuard } from '../../auth/rbac/permission.guard';
import { PermissionCode } from '../../auth/rbac/rbac.constants';
import { RequirePermission } from '../../auth/rbac/require-permission.decorator';
import { JwtPayload } from '../../auth/types/jwt-payload.type';
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
@UseGuards(JwtAuthGuard, PermissionGuard)
@Controller('contracts')
export class ContractController {
  constructor(private readonly contractService: ContractService) {}

  // The responsible of its project's site, or a platform administrator —
  // checked in the service (also for the routes below).
  @Post()
  @RequirePermission(PermissionCode.ContractCreate)
  create(@Body() dto: CreateContractDto, @CurrentUser() user: JwtPayload) {
    return this.contractService.create(dto, user.sub);
  }

  @Get()
  @RequirePermission(PermissionCode.ContractRead)
  findAll(
    @Query() query: FindContractsQueryDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.contractService.findAll(query, user.sub);
  }

  // Declared before ':id' so "types" isn't parsed as an id.
  @Get('types')
  @RequirePermission(PermissionCode.ContractRead)
  types() {
    return this.contractService.types();
  }

  // A contract restricted to others answers 404.
  @Get(':id')
  @RequirePermission(PermissionCode.ContractRead)
  findOne(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.contractService.findOneFor(id, user.sub);
  }

  @Patch(':id')
  @RequirePermission(PermissionCode.ContractUpdate)
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateContractDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.contractService.update(id, dto, user.sub);
  }

  @Post(':id/archive')
  @RequirePermission(PermissionCode.ContractArchive)
  archive(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ArchiveReasonDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.contractService.archive(id, user.sub, dto.reason);
  }

  @Post(':id/unarchive')
  @RequirePermission(PermissionCode.ContractArchive)
  unarchive(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: RestoreNoteDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.contractService.unarchive(id, user.sub, dto.note);
  }

  @Delete(':id')
  @RequirePermission(PermissionCode.ContractArchive)
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.contractService.remove(id, user.sub);
  }

  @Get(':id/access')
  @RequirePermission(PermissionCode.ContractRead)
  getAccess(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.contractService.getAccess(id, user.sub);
  }

  // The contract's responsible or a platform administrator — checked in
  // the service.
  @Put(':id/access')
  setAccess(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SetReferentialAccessDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.contractService.setAccess(id, dto.userIds, user.sub);
  }

  @Get(':id/historique')
  @RequirePermission(PermissionCode.ContractRead)
  history(
    @Param('id', ParseUUIDPipe) id: string,
    @Query() query: PaginationQueryDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.contractService.history(id, user.sub, query);
  }
}
