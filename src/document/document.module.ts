import { Module } from '@nestjs/common';
import { DossierController } from './dossier/dossier.controller';
import { DossierService } from './dossier/dossier.service';
import { MailController } from './mail/mail.controller';
import { MailService } from './mail/mail.service';
@Module({
  controllers: [DossierController, MailController],
  providers: [DossierService, MailService],
  exports: [DossierService, MailService],
})
export class DocumentModule {}
