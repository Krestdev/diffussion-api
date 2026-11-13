import { Module } from '@nestjs/common';
import { SettingsModule } from '../administration/settings/settings.module';
import { NotificationsService } from './notifications.service';
import { NotificationsController } from './notifications.controller';

@Module({
  // The module's notifications per site (PA·9), above each user's choice.
  imports: [SettingsModule],
  controllers: [NotificationsController],
  providers: [NotificationsService],
  exports: [NotificationsService],
})
export class NotificationsModule {}
