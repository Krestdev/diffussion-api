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

  @Post()
  @RequirePermission(PermissionCode.AdminManageReferentials)
  create(@Body() dto: CreateContractDto) {
    return this.contractService.create(dto);
  }

  @Get()
  findAll(
    @Query() query: FindContractsQueryDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.contractService.findAll(query, user.sub);
  }

  // Declared before ':id' so "types" isn't parsed as an id.
  @Get('types')
  types() {
    return this.contractService.types();
  }

  // A contract restricted to others answers 404.
  @Get(':id')
  findOne(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.contractService.findOneFor(id, user.sub);
  }

  @Patch(':id')
  @RequirePermission(PermissionCode.AdminManageReferentials)
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateContractDto,
  ) {
    return this.contractService.update(id, dto);
  }

  @Post(':id/archive')
  @RequirePermission(PermissionCode.AdminManageReferentials)
  archive(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ArchiveReasonDto,
  ) {
    return this.contractService.archive(id, dto.reason);
  }

  @Post(':id/unarchive')
  @RequirePermission(PermissionCode.AdminManageReferentials)
  unarchive(@Param('id', ParseUUIDPipe) id: string) {
    return this.contractService.unarchive(id);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermission(PermissionCode.AdminManageReferentials)
  remove(@Param('id', ParseUUIDPipe) id: string) {
    return this.contractService.remove(id);
  }

  @Get(':id/access')
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
  history(
    @Param('id', ParseUUIDPipe) id: string,
    @Query() query: PaginationQueryDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.contractService.history(id, user.sub, query);
  }
}
