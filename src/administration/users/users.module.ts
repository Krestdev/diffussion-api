import { Module } from '@nestjs/common';
import { NotificationsModule } from '../../notifications/notifications.module';
import { UsersService } from './users.service';
import { UsersController } from './users.controller';

@Module({
  imports: [NotificationsModule],
  controllers: [UsersController],
  providers: [UsersService],
})
export class UsersModule {}
