import { Module } from '@nestjs/common';
import { DocumentIdentityService } from './document-identity.service';
import { ModuleNotificationsService } from './module-notifications.service';
import {
  DocumentLogoController,
  SettingsController,
} from './settings.controller';
import { SettingsService } from './settings.service';

@Module({
  controllers: [SettingsController, DocumentLogoController],
  providers: [
    SettingsService,
    DocumentIdentityService,
    ModuleNotificationsService,
  ],
  exports: [
    SettingsService,
    DocumentIdentityService,
    ModuleNotificationsService,
  ],
})
export class SettingsModule {}
