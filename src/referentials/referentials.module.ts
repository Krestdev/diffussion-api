import { Module } from '@nestjs/common';
import { CorrespondantController } from './correspondent/correspondent.controller';
import { CorrespondantService } from './correspondent/correspondent.service';
import { SiteController } from './site/site.controller';
import { SiteService } from './site/site.service';
import { CategoryModule } from './category/category.module';
import { CourrierNatureModule } from './courrier-nature/courrier-nature.module';
import { CanalModule } from './canal/canal.module';
import { ContractModule } from './contract/contract.module';
import { EffetTypeModule } from './effet-type/effet-type.module';
import { CorrespondentTypeModule } from './correspondent-type/correspondent-type.module';
import { ProjectModule } from './project/project.module';

@Module({
  controllers: [SiteController, CorrespondantController],
  providers: [SiteService, CorrespondantService],
  exports: [SiteService, CorrespondantService],
  imports: [
    CategoryModule,
    CourrierNatureModule,
    CanalModule,
    EffetTypeModule,
    ContractModule,
    CorrespondentTypeModule,
    ProjectModule,
  ],
})
export class ReferentialsModule {}
