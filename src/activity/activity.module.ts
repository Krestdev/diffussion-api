import { Global, Module } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { ActivityService } from './activity.service';
import { ActivityInterceptor } from './activity.interceptor';
import { ActivityController } from './activity.controller';
import { ActivityTestController } from './activity-test.controller';

@Global()
@Module({
  controllers: [ActivityController, ActivityTestController],
  providers: [
    ActivityService,
    {
      provide: APP_INTERCEPTOR,
      useClass: ActivityInterceptor,
    },
  ],
  exports: [ActivityService],
})
export class ActivityModule {}
