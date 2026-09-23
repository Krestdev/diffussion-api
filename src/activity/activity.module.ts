import { Global, Module } from '@nestjs/common';
import { ActivityService } from './activity.service';
import { ActivityController } from './activity.controller';
import { ActivityTestController } from './activity-test.controller';

@Global()
@Module({
  controllers: [ActivityController, ActivityTestController],
  providers: [ActivityService],
  exports: [ActivityService],
})
export class ActivityModule {}
