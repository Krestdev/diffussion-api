import { Module } from '@nestjs/common';
import { NotificationsModule } from '../../notifications/notifications.module';
import { UsersService } from './users.service';
import { UsersController } from './users.controller';
import { InvitationsController } from './invitations.controller';

@Module({
  imports: [NotificationsModule],
  controllers: [UsersController, InvitationsController],
  providers: [UsersService],
})
export class UsersModule {}
