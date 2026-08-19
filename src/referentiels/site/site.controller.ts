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
import { CreateSiteDto } from './dto/create-site.dto';
import { UpdateSiteDto } from './dto/update-site.dto';
import { SiteService } from './site.service';

@ApiTags('sites')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('sites')
export class SiteController {
  constructor(private readonly siteService: SiteService) {}

  @Post()
  create(@Body() dto: CreateSiteDto) {
    return this.siteService.create(dto);
  }

  @Get()
  findAll() {
    return this.siteService.findAll();
  }

  @Get(':uuid')
  findOne(@Param('uuid', ParseUUIDPipe) uuid: string) {
    return this.siteService.findOne(uuid);
  }

  @Patch(':uuid')
  update(
    @Param('uuid', ParseUUIDPipe) uuid: string,
    @Body() dto: UpdateSiteDto,
  ) {
    return this.siteService.update(uuid, dto);
  }

  @Delete(':uuid')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@Param('uuid', ParseUUIDPipe) uuid: string) {
    return this.siteService.remove(uuid);
  }
}
