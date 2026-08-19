import {
  Body,
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { JwtPayloadWithRefreshToken } from '../../auth/types/jwt-payload.type';
import { DossierService } from './dossier.service';
import { CreateDossierDto } from './dto/create-dossier.dto';
import { FindDossiersQueryDto } from './dto/find-dossiers.query.dto';
import { UpdateDossierDto } from './dto/update-dossier.dto';

@ApiTags('dossiers')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('dossiers')
export class DossierController {
  constructor(private readonly dossierService: DossierService) {}

  @Get()
  findAll(@Query() query: FindDossiersQueryDto) {
    return 'findAll';
  }

  @Post()
  create(
    @Body() dto: CreateDossierDto,
    @CurrentUser() user: JwtPayloadWithRefreshToken,
  ) {
    return 'create';
  }

  @Get(':id')
  findOne(@Param('id', ParseIntPipe) id: number) {
    return 'findOne';
  }

  @Patch(':id')
  update(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateDossierDto,
    @CurrentUser() user: JwtPayloadWithRefreshToken,
  ) {
    return 'update';
  }

  @Post(':id/close')
  close(
    @Param('id', ParseIntPipe) id: number,
    @CurrentUser() user: JwtPayloadWithRefreshToken,
  ) {
    return 'close';
  }

  @Post(':id/reopen')
  reopen(
    @Param('id', ParseIntPipe) id: number,
    @CurrentUser() user: JwtPayloadWithRefreshToken,
  ) {
    return 'reopen';
  }

  @Post(':id/archive')
  archive(
    @Param('id', ParseIntPipe) id: number,
    @CurrentUser() user: JwtPayloadWithRefreshToken,
  ) {
    return 'archive';
  }

  @Get(':id/courriers')
  getCourriers(@Param('id', ParseIntPipe) id: number) {
    return 'getCourriers';
  }

  @Get(':id/instructions')
  getInstructions(@Param('id', ParseIntPipe) id: number) {
    return 'getInstructions';
  }

  @Get(':id/livrables')
  getLivrables(@Param('id', ParseIntPipe) id: number) {
    return 'getLivrables';
  }

  @Get(':id/historique')
  getHistorique(@Param('id', ParseIntPipe) id: number) {
    return 'getHistorique';
  }

  @Get(':id/progression')
  getProgression(@Param('id', ParseIntPipe) id: number) {
    return 'getProgression';
  }
}
