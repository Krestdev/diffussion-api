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
import { CreateEffetTypeDto } from './dto/create-effet-type.dto';
import { FindEffetTypesQueryDto } from './dto/find-effet-types.query.dto';
import { UpdateEffetTypeDto } from './dto/update-effet-type.dto';
import { EffetTypeService } from './effet-type.service';

@ApiTags('effet-types')
@ApiBearerAuth()
// Global types: platform administrators. A site's types: its responsible.
// Enforced in EffetTypeService, since the responsible needs no role for it.
@UseGuards(JwtAuthGuard)
@Controller('effet-types')
export class EffetTypeController {
  constructor(private readonly effetTypeService: EffetTypeService) {}

  @Post()
  create(@Body() dto: CreateEffetTypeDto, @CurrentUser() user: JwtPayload) {
    return this.effetTypeService.create(dto, user.sub);
  }

  @Get()
  findAll(
    @Query() query: FindEffetTypesQueryDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.effetTypeService.findAll(query, user.sub);
  }

  @Get(':id')
  findOne(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.effetTypeService.findOne(id, user.sub);
  }

  @Patch(':id')
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateEffetTypeDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.effetTypeService.update(id, dto, user.sub);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.effetTypeService.remove(id, user.sub);
  }
}
