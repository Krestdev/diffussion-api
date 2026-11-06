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
import { FindSiteListQueryDto } from '../../common/dto/site-list-item.dto';
import { CorrespondentTypeService } from './correspondent-type.service';
import { CreateCorrespondentTypeDto } from './dto/create-correspondent-type.dto';
import { UpdateCorrespondentTypeDto } from './dto/update-correspondent-type.dto';

// Each site's own (PA·7): managed by its responsible or whoever holds
// ADMIN_MANAGE_REFERENTIALS there — checked in the service.
@ApiTags('correspondent-types')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('correspondent-types')
export class CorrespondentTypeController {
  constructor(
    private readonly correspondentTypeService: CorrespondentTypeService,
  ) {}

  @Post()
  create(
    @Body() dto: CreateCorrespondentTypeDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.correspondentTypeService.create(dto, user.sub);
  }

  // The caller's own site's — every site's for a platform administrator.
  @Get()
  findAll(
    @Query() query: FindSiteListQueryDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.correspondentTypeService.findAll(query, user.sub);
  }

  @Get(':id')
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.correspondentTypeService.findOne(id);
  }

  @Patch(':id')
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateCorrespondentTypeDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.correspondentTypeService.update(id, dto, user.sub);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.correspondentTypeService.remove(id, user.sub);
  }
}
