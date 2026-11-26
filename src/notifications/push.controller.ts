import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Post,
  Put,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { CoreAuthGuard } from '../auth/guards/core-auth.guard';
import { PermissionsGuard } from '../auth/access/permissions.guard';
import type {
  AuthUser,
  CoreRequestContext,
} from '../auth/types/auth-user.type';
import {
  PushPreferenceDto,
  PushSubscribeDto,
  PushUnsubscribeDto,
} from './dto/push.dto';
import { PushService } from './push.service';

/**
 * « Notifications du navigateur » of the signed-in person, at the same paths as EXPENZO's
 * (platform/notifications/push/…), so the core's console (Mon profil) sets them in every app.
 */
@ApiTags('notifications')
@ApiBearerAuth()
@UseGuards(CoreAuthGuard, PermissionsGuard)
@Controller('platform/notifications/push')
export class PushController {
  constructor(private readonly push: PushService) {}

  /** The VAPID public key, null while push is off. */
  @Get('key')
  key() {
    return { publicKey: this.push.publicKey, enabled: this.push.enabled };
  }

  @Get('preference')
  preference(@CurrentUser() user: AuthUser) {
    return this.push.preference(user.sub);
  }

  @Put('preference')
  savePreference(
    @CurrentUser() user: AuthUser,
    @Body() dto: PushPreferenceDto,
  ) {
    return this.push.setPreference(user.sub, dto.enabled);
  }

  /** Saves this browser's subscription, with the person's language (the pop-ups' texts). */
  @Post('subscriptions')
  @HttpCode(HttpStatus.NO_CONTENT)
  subscribe(
    @CurrentUser() user: AuthUser,
    @Body() dto: PushSubscribeDto,
    @Req() request: Request & { core?: CoreRequestContext },
    @Headers('user-agent') userAgent?: string,
  ) {
    const account = request.core?.account;
    return this.push.subscribe(
      user.sub,
      dto,
      account?.language || account?.tenant.defaultLanguage,
      userAgent,
    );
  }

  /** Forgets this browser (toggle off, sign-out). */
  @Delete('subscriptions')
  @HttpCode(HttpStatus.NO_CONTENT)
  unsubscribe(@CurrentUser() user: AuthUser, @Body() dto: PushUnsubscribeDto) {
    return this.push.unsubscribe(user.sub, dto.endpoint);
  }
}
