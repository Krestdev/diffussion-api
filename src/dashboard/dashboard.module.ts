import { Module } from '@nestjs/common';
import { DashboardController } from './dashboard.controller';
import { DashboardOverviewService } from './dashboard-overview.service';
import { DashboardService } from './dashboard.service';

@Module({
  controllers: [DashboardController],
  providers: [DashboardService, DashboardOverviewService],
})
export class DashboardModule {}
