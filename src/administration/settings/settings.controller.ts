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
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { PermissionGuard } from '../../auth/rbac/permission.guard';
import { PermissionCode } from '../../auth/rbac/rbac.constants';
import { RequirePermission } from '../../auth/rbac/require-permission.decorator';
import { JwtPayload } from '../../auth/types/jwt-payload.type';
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
@UseGuards(JwtAuthGuard, PermissionGuard)
@Controller('settings')
export class SettingsController {
  constructor(
    private readonly settings: SettingsService,
    private readonly identity: DocumentIdentityService,
    private readonly notifications: ModuleNotificationsService,
  ) {}

  // The caller's own site's settings, readable by every signed-in user;
  // another site's (?siteId=) for whoever administers it.
  @Get()
  get(@Query() query: SettingsQueryDto, @CurrentUser() user: JwtPayload) {
    return this.settings.getFor(query, user.sub);
  }

  // A site's: its responsible or whoever holds ADMIN_MANAGE_SETTINGS
  // there; the common ones: a platform administrator — checked in
  // SettingsService.
  @Patch()
  update(@Body() dto: UpdateSettingsDto, @CurrentUser() user: JwtPayload) {
    return this.settings.update(dto, user.sub);
  }

  // PA·9 — the module's notifications: every event, in-app / email.
  @Get('notifications')
  @RequirePermission(PermissionCode.SettingsRead)
  getNotifications(
    @Query() query: SettingsQueryDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.notifications.getFor(query.siteId, user.sub);
  }

  @Patch('notifications')
  updateNotifications(
    @Body() dto: UpdateModuleNotificationsDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.notifications.update(dto, user.sub);
  }

  // PA·3 — the documents' letterhead. Declared before any ':param'.
  @Get('document-identity')
  getIdentity(
    @Query() query: SettingsQueryDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.identity.getFor(query.siteId, user.sub);
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
    @CurrentUser() user: JwtPayload,
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
    const file = await this.identity.logo(query.siteId ?? null);
    if (file.contentType) res.setHeader('Content-Type', file.contentType);
    res.setHeader('Cache-Control', 'public, max-age=300');
    file.body.pipe(res);
  }
}
