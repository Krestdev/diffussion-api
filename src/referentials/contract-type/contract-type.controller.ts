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
import { CoreAuthGuard } from '../../auth/guards/core-auth.guard';
import { PermissionsGuard } from '../../auth/access/permissions.guard';
import { Permission } from '../../auth/permissions';
import { RequirePermissions } from '../../auth/access/decorators';
import {
  ContractTypeService,
  CreateContractTypeDto,
  FindContractTypesQueryDto,
  UpdateContractTypeDto,
} from './contract-type.service';

// One list for every company: read by everyone, managed (settings.update) like
// the other reference lists (owner decision, permissions 2.0.0).
@ApiTags('contract-types')
@ApiBearerAuth()
@UseGuards(CoreAuthGuard, PermissionsGuard)
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
  @RequirePermissions(Permission.SETTINGS_UPDATE)
  create(@Body() dto: CreateContractTypeDto) {
    return this.types.create(dto);
  }

  @Patch(':id')
  @RequirePermissions(Permission.SETTINGS_UPDATE)
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateContractTypeDto,
  ) {
    return this.types.update(id, dto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermissions(Permission.SETTINGS_UPDATE)
  remove(@Param('id', ParseUUIDPipe) id: string) {
    return this.types.remove(id);
  }
}
