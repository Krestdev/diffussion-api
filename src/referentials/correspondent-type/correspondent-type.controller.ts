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
import { FindCompanyListQueryDto } from '../../common/dto/company-list-item.dto';
import { CorrespondentTypeService } from './correspondent-type.service';
import { CreateCorrespondentTypeDto } from './dto/create-correspondent-type.dto';
import { UpdateCorrespondentTypeDto } from './dto/update-correspondent-type.dto';

// Each company's own (PA·7): managed by whoever holds settings.update
// there — checked in the service.
@ApiTags('correspondent-types')
@ApiBearerAuth()
@UseGuards(CoreAuthGuard)
@Controller('correspondent-types')
export class CorrespondentTypeController {
  constructor(
    private readonly correspondentTypeService: CorrespondentTypeService,
  ) {}

  @Post()
  create(
    @Body() dto: CreateCorrespondentTypeDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.correspondentTypeService.create(dto, user.sub);
  }

  // The caller's own company's.
  @Get()
  findAll(
    @Query() query: FindCompanyListQueryDto,
    @CurrentUser() user: AuthUser,
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
    @CurrentUser() user: AuthUser,
  ) {
    return this.correspondentTypeService.update(id, dto, user.sub);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthUser,
  ) {
    return this.correspondentTypeService.remove(id, user.sub);
  }
}
