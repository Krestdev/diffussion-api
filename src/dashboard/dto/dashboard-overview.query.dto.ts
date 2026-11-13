import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsDateString,
  IsEnum,
  IsIn,
  IsOptional,
  IsUUID,
  ValidateIf,
} from 'class-validator';
import { CourrierDirection } from '../../../generated/prisma/client';

// "a,b" -> ['a', 'b'] (also accepts the repeated ?x=a&x=b form).
const commaList = ({ value }: { value: unknown }) =>
  typeof value === 'string'
    ? value
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean)
    : value;

export const OVERVIEW_PERIODS = [
  'today',
  '7d',
  '30d',
  'month',
  'custom',
] as const;
export type OverviewPeriod = (typeof OVERVIEW_PERIODS)[number];

export const OVERVIEW_COMPARES = ['previous', 'lastYear'] as const;
export type OverviewCompare = (typeof OVERVIEW_COMPARES)[number];

export const OVERVIEW_PRIORITIES = ['NORMALE', 'HAUTE', 'URGENTE'] as const;
export type OverviewPriority = (typeof OVERVIEW_PRIORITIES)[number];

export const EXPORT_SECTIONS = [
  'arbitration',
  'kpis',
  'volumes',
  'delays',
  'risks',
  'workload',
  'breakdown',
] as const;
export type ExportSection = (typeof EXPORT_SECTIONS)[number];

export class DashboardOverviewQueryDto {
  @ApiProperty({ description: 'The site shown — never any other' })
  @IsUUID('4')
  siteId!: string;

  @ApiPropertyOptional({ enum: OVERVIEW_PERIODS, default: '30d' })
  @IsOptional()
  @IsIn(OVERVIEW_PERIODS)
  period?: OverviewPeriod;

  @ApiPropertyOptional({ description: 'Required with period=custom' })
  @ValidateIf(
    (query: DashboardOverviewQueryDto) =>
      query.period === 'custom' || query.from !== undefined,
  )
  @IsDateString()
  from?: string;

  @ApiPropertyOptional({
    description: 'Required with period=custom; included in full',
  })
  @ValidateIf(
    (query: DashboardOverviewQueryDto) =>
      query.period === 'custom' || query.to !== undefined,
  )
  @IsDateString()
  to?: string;

  @ApiPropertyOptional({ enum: OVERVIEW_COMPARES, default: 'previous' })
  @IsOptional()
  @IsIn(OVERVIEW_COMPARES)
  compare?: OverviewCompare;

  @ApiPropertyOptional({ description: 'Comma-separated project ids' })
  @IsOptional()
  @Transform(commaList)
  @IsArray()
  @ArrayMaxSize(100)
  @IsUUID('4', { each: true })
  projectIds?: string[];

  @ApiPropertyOptional({ description: 'A contract id or a dossier id' })
  @IsOptional()
  @IsUUID('4')
  contractOrDossierId?: string;

  @ApiPropertyOptional({
    description:
      'A team: the id of one of the site roles listed in `teams`. Effets whose person in charge or supervisor holds it',
  })
  @IsOptional()
  @IsUUID('4')
  team?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID('4')
  supervisorId?: string;

  @ApiPropertyOptional({ description: 'Comma-separated effet type ids' })
  @IsOptional()
  @Transform(commaList)
  @IsArray()
  @ArrayMaxSize(100)
  @IsUUID('4', { each: true })
  typeIds?: string[];

  @ApiPropertyOptional({ enum: CourrierDirection })
  @IsOptional()
  @IsEnum(CourrierDirection)
  direction?: CourrierDirection;

  @ApiPropertyOptional({
    enum: OVERVIEW_PRIORITIES,
    description:
      "The priority of the effet's dossier or tasks. HAUTE exists on neither, so it matches nothing",
  })
  @IsOptional()
  @IsIn(OVERVIEW_PRIORITIES)
  priority?: OverviewPriority;
}

export class DashboardExportQueryDto extends DashboardOverviewQueryDto {
  @ApiProperty({ enum: ['pdf', 'xlsx'] })
  @IsIn(['pdf', 'xlsx'])
  format!: 'pdf' | 'xlsx';

  @ApiPropertyOptional({
    description: `Comma-separated, every section by default: ${EXPORT_SECTIONS.join(', ')}`,
  })
  @IsOptional()
  @Transform(commaList)
  @IsArray()
  @IsIn(EXPORT_SECTIONS, { each: true })
  sections?: ExportSection[];
}
