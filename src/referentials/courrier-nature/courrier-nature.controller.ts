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
import {
  PlatformAdmin,
  RequirePermissions,
} from '../../auth/access/decorators';
import { PaginationQueryDto } from '../../common/dto/pagination.query.dto';
import { CourrierNatureService } from './courrier-nature.service';
import { CreateCourrierNatureDto } from './dto/create-courrier-nature.dto';
import { UpdateCourrierNatureDto } from './dto/update-courrier-nature.dto';

@ApiTags('courrier-natures')
@ApiBearerAuth()
@UseGuards(CoreAuthGuard, PermissionsGuard)
@Controller('courrier-natures')
export class CourrierNatureController {
  constructor(private readonly courrierNatureService: CourrierNatureService) {}

  @Post()
  @RequirePermissions(Permission.SETTINGS_UPDATE)
  @PlatformAdmin()
  create(@Body() dto: CreateCourrierNatureDto) {
    return this.courrierNatureService.create(dto);
  }

  @Get()
  findAll(@Query() query: PaginationQueryDto) {
    return this.courrierNatureService.findAll(query);
  }

  @Get(':id')
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.courrierNatureService.findOne(id);
  }

  @Patch(':id')
  @RequirePermissions(Permission.SETTINGS_UPDATE)
  @PlatformAdmin()
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateCourrierNatureDto,
  ) {
    return this.courrierNatureService.update(id, dto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermissions(Permission.SETTINGS_UPDATE)
  @PlatformAdmin()
  remove(@Param('id', ParseUUIDPipe) id: string) {
    return this.courrierNatureService.remove(id);
  }
}
