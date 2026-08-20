import { Module } from '@nestjs/common';
import { DossierController } from './dossier/dossier.controller';
import { DossierService } from './dossier/dossier.service';

@Module({
  controllers: [DossierController],
  providers: [DossierService],
  exports: [DossierService],
})
export class DocumentModule {}
