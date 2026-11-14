import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { CoreAuthGuard } from '../auth/guards/core-auth.guard';
import { PermissionsGuard } from '../auth/access/permissions.guard';
import { Permission } from '../auth/permissions';
import { PlatformAdmin, RequirePermissions } from '../auth/access/decorators';
import { AuthUser } from '../auth/types/auth-user.type';
import { NotificationStatus } from '../../generated/prisma/client';
import { CreateNotificationDto } from './dto/create-notification.dto';
import { SetNotificationPreferencesDto } from './dto/set-notification-preferences.dto';
import { NotificationsService } from './notifications.service';

@ApiTags('notifications')
@ApiBearerAuth()
@UseGuards(CoreAuthGuard, PermissionsGuard)
@Controller('notifications')
export class NotificationsController {
  constructor(private readonly notificationsService: NotificationsService) {}

  // Notifications come from the server itself (courriers, tasks); posting
  // one by hand, to anyone, with any text, is a platform announcement and
  // reserved to platform administrators. The inbox routes below stay open
  // to every user, for their own notifications.
  @Post()
  @RequirePermissions(Permission.ROLE_ASSIGN)
  @PlatformAdmin()
  create(@Body() dto: CreateNotificationDto) {
    return this.notificationsService.create(dto);
  }

  // Each user chooses which notifications they receive.
  @Get('preferences')
  getPreferences(@CurrentUser() user: AuthUser) {
    return this.notificationsService.getPreferences(user.sub);
  }

  @Put('preferences')
  setPreferences(
    @Body() dto: SetNotificationPreferencesDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.notificationsService.setPreferences(user.sub, dto.preferences);
  }

  @Get('me')
  findMine(
    @CurrentUser() user: AuthUser,
    @Query('status') status?: NotificationStatus,
  ) {
    return this.notificationsService.findMine(user.sub, status);
  }

  @Patch('read-all')
  markAllRead(@CurrentUser() user: AuthUser) {
    return this.notificationsService.markAllRead(user.sub);
  }

  @Patch(':id/read')
  markRead(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthUser,
  ) {
    return this.notificationsService.markStatus(
      id,
      user.sub,
      NotificationStatus.READ,
    );
  }

  @Patch(':id/archive')
  archive(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthUser,
  ) {
    return this.notificationsService.markStatus(
      id,
      user.sub,
      NotificationStatus.ARCHIVED,
    );
  }
}
