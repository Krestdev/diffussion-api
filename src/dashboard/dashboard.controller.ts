import { Controller, Get, Query, Res, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { JwtPayload } from '../auth/types/jwt-payload.type';
import { exportTables, renderPdf, renderXlsx } from './dashboard-export';
import { DashboardOverviewService } from './dashboard-overview.service';
import { DashboardService } from './dashboard.service';
import {
  DashboardExportQueryDto,
  DashboardOverviewQueryDto,
  EXPORT_SECTIONS,
} from './dto/dashboard-overview.query.dto';
import { DashboardStatsQueryDto } from './dto/dashboard-stats.query.dto';

@ApiTags('dashboard')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('dashboard')
export class DashboardController {
  constructor(
    private readonly dashboardService: DashboardService,
    private readonly overviewService: DashboardOverviewService,
  ) {}

  // One site's global dashboards: DASHBOARD_GLOBAL_READ, or its responsible.
  @Get('overview')
  overview(
    @Query() query: DashboardOverviewQueryDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.overviewService.overview(query, user.sub);
  }

  @Get('export')
  async export(
    @Query() query: DashboardExportQueryDto,
    @CurrentUser() user: JwtPayload,
    @Res() res: Response,
  ) {
    const { format, sections, ...filters } = query;
    const overview = await this.overviewService.overview(filters, user.sub);
    const workload = await this.overviewService.workload(query.siteId);
    const tables = exportTables(
      overview,
      workload,
      sections?.length ? sections : EXPORT_SECTIONS,
    );
    const day = new Date().toISOString().slice(0, 10);
    const file =
      format === 'pdf'
        ? await renderPdf('Tableau de bord', tables)
        : await renderXlsx(tables);
    res.setHeader(
      'Content-Type',
      format === 'pdf'
        ? 'application/pdf'
        : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="tableau-de-bord-${day}.${format}"`,
    );
    res.send(file);
  }

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
