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
import { CourrierNatureService } from './courrier-nature.service';
import { CreateCourrierNatureDto } from './dto/create-courrier-nature.dto';
import { UpdateCourrierNatureDto } from './dto/update-courrier-nature.dto';

@ApiTags('courrier-natures')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionGuard)
@Controller('courrier-natures')
export class CourrierNatureController {
  constructor(private readonly courrierNatureService: CourrierNatureService) {}

  @Post()
  @RequirePermission(PermissionCode.AdminManageReferentials)
  create(@Body() dto: CreateCourrierNatureDto) {
    return this.courrierNatureService.create(dto);
  }

  @Get()
  findAll() {
    return this.courrierNatureService.findAll();
  }

  @Get(':id')
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.courrierNatureService.findOne(id);
  }

  @Patch(':id')
  @RequirePermission(PermissionCode.AdminManageReferentials)
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateCourrierNatureDto,
  ) {
    return this.courrierNatureService.update(id, dto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermission(PermissionCode.AdminManageReferentials)
  remove(@Param('id', ParseUUIDPipe) id: string) {
    return this.courrierNatureService.remove(id);
  }
}
