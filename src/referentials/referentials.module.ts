import { Module } from '@nestjs/common';
import { CorrespondantController } from './correspondent/correspondent.controller';
import { CorrespondantService } from './correspondent/correspondent.service';
import { ServiceController } from './service/service.controller';
import { ServiceService } from './service/service.service';
import { SiteController } from './site/site.controller';
import { SiteService } from './site/site.service';
import { CategoryModule } from './category/category.module';
import { DossierTypeModule } from './dossier-type/dossier-type.module';
import { CourrierNatureModule } from './courrier-nature/courrier-nature.module';
import { CanalModule } from './canal/canal.module';
import { CorrespondentTypeModule } from './correspondent-type/correspondent-type.module';

@Module({
  controllers: [SiteController, ServiceController, CorrespondantController],
  providers: [SiteService, ServiceService, CorrespondantService],
  exports: [SiteService, ServiceService, CorrespondantService],
  imports: [
    CategoryModule,
    DossierTypeModule,
    CourrierNatureModule,
    CanalModule,
    CorrespondentTypeModule,
  ],
})
export class ReferentialsModule {}
