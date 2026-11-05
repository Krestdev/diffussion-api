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
import { PermissionGuard } from '../../auth/rbac/permission.guard';
import { CorrespondantService } from './correspondent.service';
import { CreateCorrespondentDto } from './dto/create-correspondent.dto';
import { FindCorrespondantsQueryDto } from './dto/find-correspondents.query.dto';
import { UpdateCorrespondantDto } from './dto/update-correspondent.dto';

@ApiTags('correspondents')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionGuard)
@Controller('correspondents')
export class CorrespondantController {
  constructor(private readonly correspondentService: CorrespondantService) {}

  @Post()
  create(@Body() dto: CreateCorrespondentDto, @CurrentUser() user: JwtPayload) {
    return this.correspondentService.create(dto, user.sub);
  }

  // The caller's own site's correspondents — every site's for a platform
  // administrator (optionally ?siteId=).
  @Get()
  findAll(
    @Query() query: FindCorrespondantsQueryDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.correspondentService.findAll(query, user.sub);
  }

  @Get(':uuid')
  findOne(
    @Param('uuid', ParseUUIDPipe) uuid: string,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.correspondentService.findOne(uuid, user.sub);
  }

  @Patch(':uuid')
  update(
    @Param('uuid', ParseUUIDPipe) uuid: string,
    @Body() dto: UpdateCorrespondantDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.correspondentService.update(uuid, dto, user.sub);
  }

  @Delete(':uuid')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(
    @Param('uuid', ParseUUIDPipe) uuid: string,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.correspondentService.remove(uuid, user.sub);
  }
}
