import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsIn, IsOptional, IsTimeZone } from 'class-validator';

export const TREND_PERIODS = [7, 30] as const;
export const DASHBOARD_SCOPES = ['mine', 'global'] as const;
export type DashboardScope = (typeof DASHBOARD_SCOPES)[number];
export type TrendPeriod = (typeof TREND_PERIODS)[number];

export class DashboardStatsQueryDto {
  @ApiPropertyOptional({
    enum: TREND_PERIODS,
    default: 7,
    description: 'Length of the incoming-courrier trend, in days',
  })
  @IsOptional()
  @Type(() => Number)
  @IsIn(TREND_PERIODS)
  days?: TrendPeriod;

  @ApiPropertyOptional({
    example: 'Africa/Douala',
    default: 'UTC',
    description:
      "IANA time zone the trend's days are cut in (the viewer's own, so a courrier received at 00:30 local lands on the right day)",
  })
  @IsOptional()
  @IsTimeZone()
  tz?: string;

  @ApiPropertyOptional({
    enum: DASHBOARD_SCOPES,
    default: 'mine',
    description:
      'mine: what the caller sees. global: every site (Supervision générale) — requires DASHBOARD_GLOBAL_READ, held globally',
  })
  @IsOptional()
  @IsIn(DASHBOARD_SCOPES)
  scope?: DashboardScope;
}
