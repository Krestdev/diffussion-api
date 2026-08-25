import { Module } from '@nestjs/common';
import { DossierTypeService } from './dossier-type.service';
import { DossierTypeController } from './dossier-type.controller';

@Module({
  controllers: [DossierTypeController],
  providers: [DossierTypeService],
})
export class DossierTypeModule {}
