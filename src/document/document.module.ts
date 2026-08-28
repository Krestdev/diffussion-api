import { Module } from '@nestjs/common';
import { CircuitsModule } from '../circuits/circuits.module';
import { DossierController } from './dossier/dossier.controller';
import { DossierService } from './dossier/dossier.service';
import { MailController } from './mail/mail.controller';
import { MailService } from './mail/mail.service';
import { DeliverableController } from './deliverable/deliverable.controller';
import { DeliverableService } from './deliverable/deliverable.service';
@Module({
  imports: [CircuitsModule],
  controllers: [DossierController, MailController, DeliverableController],
  providers: [DossierService, MailService, DeliverableService],
  exports: [DossierService, MailService, DeliverableService],
})
export class DocumentModule {}
