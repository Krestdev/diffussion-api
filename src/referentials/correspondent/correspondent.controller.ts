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
import { PermissionsGuard } from '../../auth/access/permissions.guard';
import { Permission } from '../../auth/permissions';
import { RequirePermissions } from '../../auth/access/decorators';
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
@UseGuards(CoreAuthGuard, PermissionsGuard)
@Controller('correspondents')
export class CorrespondantController {
  constructor(private readonly correspondentService: CorrespondantService) {}

  @Post()
  @RequirePermissions(Permission.CORRESPONDENT_CREATE)
  create(@Body() dto: CreateCorrespondentDto, @CurrentUser() user: AuthUser) {
    return this.correspondentService.create(dto, user.sub);
  }

  // The caller's own company's correspondents — every company's for a platform
  // administrator (optionally ?companyId=).
  @Get()
  @RequirePermissions(Permission.CORRESPONDENT_READ)
  findAll(
    @Query() query: FindCorrespondantsQueryDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.correspondentService.findAll(query, user.sub);
  }

  @Get(':uuid')
  @RequirePermissions(Permission.CORRESPONDENT_READ)
  findOne(
    @Param('uuid', ParseUUIDPipe) uuid: string,
    @CurrentUser() user: AuthUser,
  ) {
    return this.correspondentService.findOne(uuid, user.sub);
  }

  @Patch(':uuid')
  update(
    @Param('uuid', ParseUUIDPipe) uuid: string,
    @Body() dto: UpdateCorrespondantDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.correspondentService.update(uuid, dto, user.sub);
  }

  @Get(':uuid/contacts')
  @RequirePermissions(Permission.CORRESPONDENT_READ)
  findContacts(
    @Param('uuid', ParseUUIDPipe) uuid: string,
    @Query() query: PaginationQueryDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.correspondentService.findContacts(uuid, query, user.sub);
  }

  @Post(':uuid/contacts')
  @RequirePermissions(Permission.CORRESPONDENT_UPDATE)
  createContact(
    @Param('uuid', ParseUUIDPipe) uuid: string,
    @Body() dto: CreateCorrespondentContactDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.correspondentService.createContact(uuid, dto, user.sub);
  }

  @Patch(':uuid/contacts/:contactId')
  @RequirePermissions(Permission.CORRESPONDENT_UPDATE)
  updateContact(
    @Param('uuid', ParseUUIDPipe) uuid: string,
    @Param('contactId', ParseUUIDPipe) contactId: string,
    @Body() dto: UpdateCorrespondentContactDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.correspondentService.updateContact(
      uuid,
      contactId,
      dto,
      user.sub,
    );
  }

  @Delete(':uuid/contacts/:contactId')
  @RequirePermissions(Permission.CORRESPONDENT_UPDATE)
  @HttpCode(HttpStatus.NO_CONTENT)
  removeContact(
    @Param('uuid', ParseUUIDPipe) uuid: string,
    @Param('contactId', ParseUUIDPipe) contactId: string,
    @CurrentUser() user: AuthUser,
  ) {
    return this.correspondentService.removeContact(uuid, contactId, user.sub);
  }

  @Delete(':uuid')
  @RequirePermissions(Permission.CORRESPONDENT_ARCHIVE)
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(
    @Param('uuid', ParseUUIDPipe) uuid: string,
    @CurrentUser() user: AuthUser,
  ) {
    return this.correspondentService.remove(uuid, user.sub);
  }
}
