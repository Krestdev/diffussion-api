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
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { JwtPayload } from '../../auth/types/jwt-payload.type';
import { FindCanalsQueryDto } from './dto/find-canals.query.dto';
import { PermissionGuard } from '../../auth/rbac/permission.guard';
import { CanalService } from './canal.service';
import { CreateCanalDto } from './dto/create-canal.dto';
import { UpdateCanalDto } from './dto/update-canal.dto';

@ApiTags('canaux')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionGuard)
@Controller('canaux')
export class CanalController {
  constructor(private readonly canalService: CanalService) {}

  @Post()
  create(@Body() dto: CreateCanalDto, @CurrentUser() user: JwtPayload) {
    return this.canalService.create(dto, user.sub);
  }

  // The caller's own site's canaux — every site's for a platform
  // administrator (optionally ?siteId=).
  @Get()
  findAll(@Query() query: FindCanalsQueryDto, @CurrentUser() user: JwtPayload) {
    return this.canalService.findAll(query, user.sub);
  }

  @Get(':id')
  findOne(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.canalService.findOne(id, user.sub);
  }

  @Patch(':id')
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateCanalDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.canalService.update(id, dto, user.sub);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.canalService.remove(id, user.sub);
  }
}
