import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Patch,
  Req,
  ServiceUnavailableException,
  UseGuards,
} from '@nestjs/common';
import { ApiCookieAuth, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { CoreClient } from '../core/core-client';
import { AuthService } from './auth.service';
import { CurrentUser } from './decorators/current-user.decorator';
import { SetLanguageDto } from './dto/set-language.dto';
import { accessToken, CoreAuthGuard } from './guards/core-auth.guard';
import { AuthUser, CoreRequestContext } from './types/auth-user.type';

// Signing in, out, refreshing sessions, passwords and invitations all happen at the CREAPP core.
@ApiTags('auth')
@ApiCookieAuth('creapp_access')
@UseGuards(CoreAuthGuard)
@Controller('auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly core: CoreClient,
  ) {}

  @Get('me')
  me(
    @CurrentUser() user: AuthUser,
    @Req() request: Request & { core?: CoreRequestContext },
  ) {
    return this.authService.me(user, request.core!);
  }

  /**
   * The person's interface language, saved at the core (the platform keeps it for every app and
   * for emails), as EXPENZO does.
   */
  @Patch('me/language')
  @HttpCode(HttpStatus.NO_CONTENT)
  async setLanguage(@Req() request: Request, @Body() dto: SetLanguageDto) {
    try {
      await this.core.setLanguage(accessToken(request)!, dto.language);
    } catch {
      throw new ServiceUnavailableException({
        code: 'CORE_UNAVAILABLE',
        message: 'The language could not be saved at the CREAPP platform',
      });
    }
  }
}
