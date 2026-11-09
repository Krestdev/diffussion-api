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
import { PermissionCode } from '../../auth/rbac/rbac.constants';
import { RequirePermission } from '../../auth/rbac/require-permission.decorator';
import { PaginationQueryDto } from '../../common/dto/pagination.query.dto';
import { CorrespondantService } from './correspondent.service';
import {
  CreateCorrespondentContactDto,
  UpdateCorrespondentContactDto,
} from './dto/correspondent-contact.dto';
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
  @RequirePermission(PermissionCode.CorrespondentCreate)
  create(@Body() dto: CreateCorrespondentDto, @CurrentUser() user: JwtPayload) {
    return this.correspondentService.create(dto, user.sub);
  }

  // The caller's own site's correspondents — every site's for a platform
  // administrator (optionally ?siteId=).
  @Get()
  @RequirePermission(PermissionCode.CorrespondentRead)
  findAll(
    @Query() query: FindCorrespondantsQueryDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.correspondentService.findAll(query, user.sub);
  }

  @Get(':uuid')
  @RequirePermission(PermissionCode.CorrespondentRead)
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

  @Get(':uuid/contacts')
  @RequirePermission(PermissionCode.CorrespondentRead)
  findContacts(
    @Param('uuid', ParseUUIDPipe) uuid: string,
    @Query() query: PaginationQueryDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.correspondentService.findContacts(uuid, query, user.sub);
  }

  @Post(':uuid/contacts')
  @RequirePermission(PermissionCode.CorrespondentUpdate)
  createContact(
    @Param('uuid', ParseUUIDPipe) uuid: string,
    @Body() dto: CreateCorrespondentContactDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.correspondentService.createContact(uuid, dto, user.sub);
  }

  @Patch(':uuid/contacts/:contactId')
  @RequirePermission(PermissionCode.CorrespondentUpdate)
  updateContact(
    @Param('uuid', ParseUUIDPipe) uuid: string,
    @Param('contactId', ParseUUIDPipe) contactId: string,
    @Body() dto: UpdateCorrespondentContactDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.correspondentService.updateContact(
      uuid,
      contactId,
      dto,
      user.sub,
    );
  }

  @Delete(':uuid/contacts/:contactId')
  @RequirePermission(PermissionCode.CorrespondentUpdate)
  @HttpCode(HttpStatus.NO_CONTENT)
  removeContact(
    @Param('uuid', ParseUUIDPipe) uuid: string,
    @Param('contactId', ParseUUIDPipe) contactId: string,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.correspondentService.removeContact(uuid, contactId, user.sub);
  }

  @Delete(':uuid')
  @RequirePermission(PermissionCode.CorrespondentArchive)
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(
    @Param('uuid', ParseUUIDPipe) uuid: string,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.correspondentService.remove(uuid, user.sub);
  }
}
