import { Controller, Get, Req, UseGuards } from '@nestjs/common';
import { ApiCookieAuth, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { AuthService } from './auth.service';
import { CurrentUser } from './decorators/current-user.decorator';
import { CoreAuthGuard } from './guards/core-auth.guard';
import { AuthUser, CoreRequestContext } from './types/auth-user.type';

// Signing in, out, refreshing sessions, passwords and invitations all happen at the CREAPP core.
@ApiTags('auth')
@ApiCookieAuth('creapp_access')
@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @UseGuards(CoreAuthGuard)
  @Get('me')
  me(
    @CurrentUser() user: AuthUser,
    @Req() request: Request & { core?: CoreRequestContext },
  ) {
    return this.authService.me(user, request.core!);
  }
}
