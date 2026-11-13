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
import {
  CreateSiteListItemDto,
  FindSiteListQueryDto,
  UpdateSiteListItemDto,
} from '../../common/dto/site-list-item.dto';
import { DossierTypeService } from './dossier-type.service';

// Each site's own (PA·7): managed by its responsible or whoever holds
// ADMIN_MANAGE_REFERENTIALS there — checked in the service.
@ApiTags('dossier-types')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('dossier-types')
export class DossierTypeController {
  constructor(private readonly types: DossierTypeService) {}

  @Post()
  create(@Body() dto: CreateSiteListItemDto, @CurrentUser() user: JwtPayload) {
    return this.types.create(dto, user.sub);
  }

  // The caller's own site's — every site's for a platform administrator.
  @Get()
  findAll(
    @Query() query: FindSiteListQueryDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.types.findAll(query, user.sub);
  }

  @Get(':id')
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.types.findOne(id);
  }

  @Patch(':id')
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateSiteListItemDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.types.update(id, dto, user.sub);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.types.remove(id, user.sub);
  }
}
