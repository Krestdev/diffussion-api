import { Module } from '@nestjs/common';
import { InstructionsModule } from '../instructions/instructions.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { DossierController } from './dossier/dossier.controller';
import { DossierService } from './dossier/dossier.service';
import { DossierLatenessService } from './dossier/dossier-lateness.service';
import { MailController } from './mail/mail.controller';
import { MailService } from './mail/mail.service';
import { DeliverableController } from './deliverable/deliverable.controller';
import { DeliverableService } from './deliverable/deliverable.service';
@Module({
  imports: [InstructionsModule, NotificationsModule],
  controllers: [DossierController, MailController, DeliverableController],
  providers: [
    DossierService,
    DossierLatenessService,
    MailService,
    DeliverableService,
  ],
  exports: [DossierService, MailService, DeliverableService],
})
export class DomainModule {}
