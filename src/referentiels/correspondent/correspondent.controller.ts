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
import { CorrespondantService } from './correspondent.service';
import { CreateCorrespondentDto } from './dto/create-correspondent.dto';
import { FindCorrespondantsQueryDto } from './dto/find-correspondents.query.dto';
import { UpdateCorrespondantDto } from './dto/update-correspondent.dto';

@ApiTags('correspondents')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('correspondents')
export class CorrespondantController {
  constructor(private readonly correspondentService: CorrespondantService) {}

  @Post()
  create(@Body() dto: CreateCorrespondentDto) {
    return 'create correspondent';
  }

  @Get()
  findAll(@Query() query: FindCorrespondantsQueryDto) {
    return 'find all correspodent';
  }

  @Get(':uuid')
  findOne(@Param('uuid', ParseUUIDPipe) uuid: string) {
    return 'find one correspodent';
  }

  @Patch(':uuid')
  update(
    @Param('uuid', ParseUUIDPipe) uuid: string,
    @Body() dto: UpdateCorrespondantDto,
  ) {
    return 'update correspondent';
  }

  @Delete(':uuid')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@Param('uuid', ParseUUIDPipe) uuid: string) {
    return 'delete correspondent';
  }
}
