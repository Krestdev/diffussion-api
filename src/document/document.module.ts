import { Module } from '@nestjs/common';
import { DocumentController } from './document.controller';
import { DocumentService } from './document.service';
import { DossierController } from './dossier/dossier.controller';
import { DossierService } from './dossier/dossier.service';

@Module({
  controllers: [DocumentController, DossierController],
  providers: [DocumentService, DossierService],
  exports: [DocumentService, DossierService],
})
export class DocumentModule {}
