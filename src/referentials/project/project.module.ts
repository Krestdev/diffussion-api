import { Module } from '@nestjs/common';
import { NotificationsModule } from '../../notifications/notifications.module';
import { ProjectController } from './project.controller';
import { ProjectUsageController } from './project-usage.controller';
import { ProjectService } from './project.service';

@Module({
  imports: [NotificationsModule],
  controllers: [ProjectController, ProjectUsageController],
  providers: [ProjectService],
  exports: [ProjectService],
})
export class ProjectModule {}
