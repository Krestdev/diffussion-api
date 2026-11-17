import { Module } from '@nestjs/common';
import { DomainModule } from '../domain/domain.module';
import { PortalController } from './portal.controller';
import { PortalService } from './portal.service';
import { ProjectPortalController } from './project-portal.controller';
import { UserResponsibilitiesController } from './user-responsibilities.controller';
import { UserResponsibilitiesService } from './user-responsibilities.service';

@Module({
  imports: [DomainModule],
  controllers: [
    PortalController,
    ProjectPortalController,
    UserResponsibilitiesController,
  ],
  providers: [PortalService, UserResponsibilitiesService],
})
export class PortalModule {}
