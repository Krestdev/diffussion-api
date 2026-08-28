import { Controller, Get } from '@nestjs/common';
import { AppService } from './app.service';
import { ActivityService } from './activity/activity.service';

@Controller()
export class AppController {
  constructor(
    private readonly appService: AppService,
    private readonly activity: ActivityService,
  ) {}

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
