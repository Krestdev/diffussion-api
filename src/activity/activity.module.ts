import { Global, Module } from '@nestjs/common';
import { ActivityService } from './activity.service';
import { ActivityController } from './activity.controller';
import { AuditFeedService } from './audit-feed.service';

@Global()
@Module({
  controllers: [ActivityController],
  providers: [ActivityService, AuditFeedService],
  exports: [ActivityService],
})
export class ActivityModule {}
