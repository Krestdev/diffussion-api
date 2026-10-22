import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsIn, IsOptional, IsTimeZone } from 'class-validator';

export const TREND_PERIODS = [7, 30] as const;
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
}
