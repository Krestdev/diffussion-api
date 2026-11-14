import {
  Body,
  Controller,
  Get,
  Patch,
  Query,
  Res,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiConsumes, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { memoryStorage } from 'multer';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import { CoreAuthGuard } from '../../auth/guards/core-auth.guard';
import { PermissionsGuard } from '../../auth/access/permissions.guard';
import { Permission } from '../../auth/permissions';
import { RequirePermissions } from '../../auth/access/decorators';
import { AuthUser } from '../../auth/types/auth-user.type';
import {
  DocumentIdentityService,
  LOGO_MAX_BYTES,
} from './document-identity.service';
import { UpdateDocumentIdentityDto } from './dto/document-identity.dto';
import { UpdateModuleNotificationsDto } from './dto/module-notifications.dto';
import { ModuleNotificationsService } from './module-notifications.service';
import { SettingsQueryDto, UpdateSettingsDto } from './dto/update-settings.dto';
import { SettingsService } from './settings.service';

@ApiTags('settings')
@ApiBearerAuth()
@UseGuards(CoreAuthGuard, PermissionsGuard)
@Controller('settings')
export class SettingsController {
  constructor(
    private readonly settings: SettingsService,
    private readonly identity: DocumentIdentityService,
    private readonly notifications: ModuleNotificationsService,
  ) {}

  // The caller's own company's settings, readable by every signed-in user;
  // another company's (?companyId=) for whoever administers it.
  @Get()
  get(@Query() query: SettingsQueryDto, @CurrentUser() user: AuthUser) {
    return this.settings.getFor(query, user.sub);
  }

  // A company's: its responsible or whoever holds ADMIN_MANAGE_SETTINGS
  // there; the common ones: a platform administrator — checked in
  // SettingsService.
  @Patch()
  update(@Body() dto: UpdateSettingsDto, @CurrentUser() user: AuthUser) {
    return this.settings.update(dto, user.sub);
  }

  // PA·9 — the module's notifications: every event, in-app / email.
  @Get('notifications')
  @RequirePermissions(Permission.SETTINGS_READ)
  getNotifications(
    @Query() query: SettingsQueryDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.notifications.getFor(query.companyId, user.sub);
  }

  @Patch('notifications')
  updateNotifications(
    @Body() dto: UpdateModuleNotificationsDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.notifications.update(dto, user.sub);
  }

  // PA·3 — the documents' letterhead. Declared before any ':param'.
  @Get('document-identity')
  getIdentity(@Query() query: SettingsQueryDto, @CurrentUser() user: AuthUser) {
    return this.identity.getFor(query.companyId, user.sub);
  }

  @Patch('document-identity')
  @ApiConsumes('multipart/form-data', 'application/json')
  @UseInterceptors(
    FileInterceptor('logo', {
      storage: memoryStorage(),
      // A little over the limit, so the service answers a clear 400.
      limits: { fileSize: LOGO_MAX_BYTES + 1 },
    }),
  )
  updateIdentity(
    @Body() dto: UpdateDocumentIdentityDto,
    @UploadedFile() logo: Express.Multer.File | undefined,
    @CurrentUser() user: AuthUser,
  ) {
    return this.identity.update(dto, logo, user.sub);
  }
}

/**
 * The logo file, without a token: an <img src> can't send one, and a
 * letterhead logo is no secret.
 */
@ApiTags('settings')
@Controller('settings/document-identity')
export class DocumentLogoController {
  constructor(private readonly identity: DocumentIdentityService) {}

  @Get('logo')
  async logo(@Query() query: SettingsQueryDto, @Res() res: Response) {
    const file = await this.identity.logo(query.companyId ?? null);
    if (file.contentType) res.setHeader('Content-Type', file.contentType);
    res.setHeader('Cache-Control', 'public, max-age=300');
    file.body.pipe(res);
  }
}
