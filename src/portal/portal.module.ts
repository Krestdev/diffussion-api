import { Module } from '@nestjs/common';
import { DomainModule } from '../domain/domain.module';
import { PortalController } from './portal.controller';
import { PortalService } from './portal.service';
import { ProjectPortalController } from './project-portal.controller';

@Module({
  imports: [DomainModule],
  controllers: [PortalController, ProjectPortalController],
  providers: [PortalService],
})
export class PortalModule {}
