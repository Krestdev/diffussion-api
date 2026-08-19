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
import { CorrespondantService } from './correspondant.service';
import { CreateCorrespondantDto } from './dto/create-correspondant.dto';
import { FindCorrespondantsQueryDto } from './dto/find-correspondants.query.dto';
import { UpdateCorrespondantDto } from './dto/update-correspondant.dto';

@ApiTags('correspondants')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('correspondants')
export class CorrespondantController {
  constructor(private readonly correspondantService: CorrespondantService) {}

  @Post()
  create(@Body() dto: CreateCorrespondantDto) {
    return this.correspondantService.create(dto);
  }

  @Get()
  findAll(@Query() query: FindCorrespondantsQueryDto) {
    return this.correspondantService.findAll(query);
  }

  @Get(':uuid')
  findOne(@Param('uuid', ParseUUIDPipe) uuid: string) {
    return this.correspondantService.findOne(uuid);
  }

  @Patch(':uuid')
  update(
    @Param('uuid', ParseUUIDPipe) uuid: string,
    @Body() dto: UpdateCorrespondantDto,
  ) {
    return this.correspondantService.update(uuid, dto);
  }

  @Delete(':uuid')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@Param('uuid', ParseUUIDPipe) uuid: string) {
    return this.correspondantService.remove(uuid);
  }
}
