import { Controller, Get, Param, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { AppAdmin } from '../auth/access/decorators';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { AppAdminGuard } from '../auth/guards/app-admin.guard';
import { AuthUser } from '../auth/types/auth-user.type';
import type { ResponsibilityItem } from './user-responsibilities';
import { UserResponsibilitiesService } from './user-responsibilities.service';

/**
 * Contract C9, app-admin side (as EXPENZO's): what a person still holds in Diffusion. The core
 * shows it before deleting them (history kept) and refuses while anything is listed. Only
 * core-signed app-admin tokens (AppAdminGuard), for the token's company; an unknown id: nothing.
 */
@ApiTags('app-admin')
@ApiBearerAuth()
@AppAdmin()
@UseGuards(AppAdminGuard)
@Controller('app-admin/users')
export class UserResponsibilitiesController {
  constructor(private readonly responsibilities: UserResponsibilitiesService) {}

  @Get(':userId/responsibilities')
  responsibilitiesOf(
    @CurrentUser() user: AuthUser,
    @Param('userId') userId: string,
  ): Promise<{ items: ResponsibilityItem[] }> {
    return this.responsibilities.of(user.companyId, userId);
  }
}
