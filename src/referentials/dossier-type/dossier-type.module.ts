import { Module } from '@nestjs/common';
import { DossierTypeController } from './dossier-type.controller';
import { DossierTypeService } from './dossier-type.service';

@Module({
  controllers: [DossierTypeController],
  providers: [DossierTypeService],
})
export class DossierTypeModule {}
