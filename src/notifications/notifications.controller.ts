import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PermissionGuard } from '../auth/rbac/permission.guard';
import { PermissionCode } from '../auth/rbac/rbac.constants';
import {
  PlatformOnly,
  RequirePermission,
} from '../auth/rbac/require-permission.decorator';
import { JwtPayloadWithRefreshToken } from '../auth/types/jwt-payload.type';
import { NotificationStatus } from '../../generated/prisma/client';
import { CreateNotificationDto } from './dto/create-notification.dto';
import { NotificationsService } from './notifications.service';

@ApiTags('notifications')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionGuard)
@Controller('notifications')
export class NotificationsController {
  constructor(private readonly notificationsService: NotificationsService) {}

  // Notifications come from the server itself (courriers, tasks); posting
  // one by hand, to anyone, with any text, is a platform announcement and
  // reserved to platform administrators. The inbox routes below stay open
  // to every user, for their own notifications.
  @Post()
  @RequirePermission(PermissionCode.AdminManageUsers)
  @PlatformOnly()
  create(@Body() dto: CreateNotificationDto) {
    return this.notificationsService.create(dto);
  }

  @Get('me')
  findMine(
    @CurrentUser() user: JwtPayloadWithRefreshToken,
    @Query('status') status?: NotificationStatus,
  ) {
    return this.notificationsService.findMine(user.sub, status);
  }

  @Patch(':id/read')
  markRead(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: JwtPayloadWithRefreshToken,
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
    @CurrentUser() user: JwtPayloadWithRefreshToken,
  ) {
    return this.notificationsService.markStatus(
      id,
      user.sub,
      NotificationStatus.ARCHIVED,
    );
  }
}
