import { Controller, Get, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { CoreAuthGuard } from '../auth/guards/core-auth.guard';
import { AuthUser, CoreRequestContext } from '../auth/types/auth-user.type';
import { PortalService } from './portal.service';

/**
 * Diffusion's tile on the core's "Accueil du portail" (contract C6), called by the core with the
 * person's own token. No permission: each kind of work checks its own.
 */
@ApiTags('portal')
@ApiBearerAuth()
@UseGuards(CoreAuthGuard)
@Controller('portal')
export class PortalController {
  constructor(private readonly portal: PortalService) {}

  @Get('summary')
  summary(
    @CurrentUser() user: AuthUser,
    @Req() request: Request & { core?: CoreRequestContext },
  ) {
    return this.portal.summary(user, request.core);
  }
}
