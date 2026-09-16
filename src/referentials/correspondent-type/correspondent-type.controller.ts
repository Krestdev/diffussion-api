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
import { RequirePermission } from '../../auth/rbac/require-permission.decorator';
import { PaginationQueryDto } from '../../common/dto/pagination.dto';
import { CorrespondentTypeService } from './correspondent-type.service';
import { CreateCorrespondentTypeDto } from './dto/create-correspondent-type.dto';
import { UpdateCorrespondentTypeDto } from './dto/update-correspondent-type.dto';

@ApiTags('correspondent-types')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionGuard)
@Controller('correspondent-types')
export class CorrespondentTypeController {
  constructor(
    private readonly correspondentTypeService: CorrespondentTypeService,
  ) {}

  @Post()
  @RequirePermission(PermissionCode.AdminManageReferentials)
  create(@Body() dto: CreateCorrespondentTypeDto) {
    return this.correspondentTypeService.create(dto);
  }

  @Get()
  findAll(@Query() query: PaginationQueryDto) {
    return this.correspondentTypeService.findAll(query);
  }

  @Get(':id')
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.correspondentTypeService.findOne(id);
  }

  @Patch(':id')
  @RequirePermission(PermissionCode.AdminManageReferentials)
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateCorrespondentTypeDto,
  ) {
    return this.correspondentTypeService.update(id, dto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermission(PermissionCode.AdminManageReferentials)
  remove(@Param('id', ParseUUIDPipe) id: string) {
    return this.correspondentTypeService.remove(id);
  }
}
