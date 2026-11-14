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
import { CoreAuthGuard } from '../../auth/guards/core-auth.guard';
import { AuthUser } from '../../auth/types/auth-user.type';
import {
  CreateCompanyListItemDto,
  FindCompanyListQueryDto,
  UpdateCompanyListItemDto,
} from '../../common/dto/company-list-item.dto';
import { DossierTypeService } from './dossier-type.service';

// Each company's own (PA·7): managed by whoever holds settings.update
// there — checked in the service.
@ApiTags('dossier-types')
@ApiBearerAuth()
@UseGuards(CoreAuthGuard)
@Controller('dossier-types')
export class DossierTypeController {
  constructor(private readonly types: DossierTypeService) {}

  @Post()
  create(@Body() dto: CreateCompanyListItemDto, @CurrentUser() user: AuthUser) {
    return this.types.create(dto, user.sub);
  }

  // The caller's own company's.
  @Get()
  findAll(
    @Query() query: FindCompanyListQueryDto,
    @CurrentUser() user: AuthUser,
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
    @Body() dto: UpdateCompanyListItemDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.types.update(id, dto, user.sub);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthUser,
  ) {
    return this.types.remove(id, user.sub);
  }
}
