import { Module } from '@nestjs/common';
import { CircuitInstanceModule } from '../circuits/circuit-instance/circuit-instance.module';
import { DashboardController } from './dashboard.controller';
import { DashboardService } from './dashboard.service';

@Module({
  imports: [CircuitInstanceModule],
  controllers: [DashboardController],
  providers: [DashboardService],
})
export class DashboardModule {}
