import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { JwtPayload } from '../auth/types/jwt-payload.type';
import { DashboardService } from './dashboard.service';
import { DashboardStatsQueryDto } from './dto/dashboard-stats.query.dto';

@ApiTags('dashboard')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('dashboard')
export class DashboardController {
  constructor(private readonly dashboardService: DashboardService) {}

  // No @RequirePermission: every signed-in user has a dashboard. Sections
  // are gated individually inside the service (null when not permitted).
  @Get('stats')
  getStats(
    @Query() query: DashboardStatsQueryDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.dashboardService.getStats(user.sub, query);
  }
}
