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
import {
  ContractTypeService,
  CreateContractTypeDto,
  FindContractTypesQueryDto,
  UpdateContractTypeDto,
} from './contract-type.service';

// One list for every site: read by everyone, managed by a platform
// administrator.
@ApiTags('contract-types')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionGuard)
@Controller('contract-types')
export class ContractTypeController {
  constructor(private readonly types: ContractTypeService) {}

  @Get()
  findAll(@Query() query: FindContractTypesQueryDto) {
    return this.types.findAll(query);
  }

  @Get(':id')
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.types.findOne(id);
  }

  @Post()
  @RequirePermission(PermissionCode.AdminManageReferentials)
  @PlatformOnly()
  create(@Body() dto: CreateContractTypeDto) {
    return this.types.create(dto);
  }

  @Patch(':id')
  @RequirePermission(PermissionCode.AdminManageReferentials)
  @PlatformOnly()
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateContractTypeDto,
  ) {
    return this.types.update(id, dto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermission(PermissionCode.AdminManageReferentials)
  @PlatformOnly()
  remove(@Param('id', ParseUUIDPipe) id: string) {
    return this.types.remove(id);
  }
}
