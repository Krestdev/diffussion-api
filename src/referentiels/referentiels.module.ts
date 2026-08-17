import { Module } from '@nestjs/common';
import { CorrespondantController } from './correspondant/correspondant.controller';
import { CorrespondantService } from './correspondant/correspondant.service';
import { ServiceController } from './service/service.controller';
import { ServiceService } from './service/service.service';
import { SiteController } from './site/site.controller';
import { SiteService } from './site/site.service';

@Module({
  controllers: [SiteController, ServiceController, CorrespondantController],
  providers: [SiteService, ServiceService, CorrespondantService],
  exports: [SiteService, ServiceService, CorrespondantService],
})
export class ReferentielsModule {}
