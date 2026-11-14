import { Module } from '@nestjs/common';
import { CorrespondantController } from './correspondent/correspondent.controller';
import { CorrespondantService } from './correspondent/correspondent.service';
import { CompanyController } from './company/company.controller';
import { CompanyService } from './company/company.service';
import { CategoryModule } from './category/category.module';
import { CourrierNatureModule } from './courrier-nature/courrier-nature.module';
import { CanalModule } from './canal/canal.module';
import { ContractModule } from './contract/contract.module';
import { EffetTypeModule } from './effet-type/effet-type.module';
import { CorrespondentTypeModule } from './correspondent-type/correspondent-type.module';
import { ProjectModule } from './project/project.module';
import { ContractTypeModule } from './contract-type/contract-type.module';
import { DossierTypeModule } from './dossier-type/dossier-type.module';

@Module({
  controllers: [CompanyController, CorrespondantController],
  providers: [CompanyService, CorrespondantService],
  exports: [CompanyService, CorrespondantService],
  imports: [
    CategoryModule,
    CourrierNatureModule,
    CanalModule,
    EffetTypeModule,
    ContractModule,
    CorrespondentTypeModule,
    ProjectModule,
    ContractTypeModule,
    DossierTypeModule,
  ],
})
export class ReferentialsModule {}
