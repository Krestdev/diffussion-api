import { Module } from '@nestjs/common';
import { SettingsModule } from '../administration/settings/settings.module';
import { DigestService } from './digest.service';
import { NotificationsService } from './notifications.service';
import { NotificationsController } from './notifications.controller';

@Module({
  // The module's notifications per company (PA·9), above each user's choice.
  imports: [SettingsModule],
  controllers: [NotificationsController],
  // DigestService: the 08:00 summary of what waits (as EXPENZO's).
  providers: [NotificationsService, DigestService],
  exports: [NotificationsService],
})
export class NotificationsModule {}
