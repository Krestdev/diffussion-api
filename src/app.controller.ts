import { Controller, Get } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import { AppService } from './app.service';
import { ActivityService } from './activity/activity.service';

@Controller()
export class AppController {
  constructor(
    private readonly appService: AppService,
    private readonly activity: ActivityService,
  ) {}

  /** Container and core health check (manifest healthUrl), outside /api/v1, as EXPENZO. */
  @SkipThrottle()
  @Get('health')
  health(): { status: 'ok' } {
    return { status: 'ok' };
  }

  @Get()
  getHello(): string {
    return this.appService.getHello();
  }

  @Get('test-system-log')
  async testSystemLog() {
    await this.activity.record({
      action: 'system.health-check',
      message: 'Scheduled health check executed',
    });
    return { ok: true };
  }
}
