import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsDateString,
  IsEnum,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
} from 'class-validator';
import { ActivityLevel } from 'generated/prisma/enums';
import { AUDIT_CATEGORIES, AuditCategory } from '../audit-categories';

// "a,b" -> ['a', 'b'] (also accepts the repeated ?x=a&x=b form).
const commaList = ({ value }: { value: unknown }) =>
  typeof value === 'string'
    ? value
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean)
    : value;

export class FindActivityLogsQueryDto {
  @ApiPropertyOptional({ description: 'Search in action/message' })
  @IsOptional()
  @IsString()
  search?: string;

  @ApiPropertyOptional({ enum: ActivityLevel })
  @IsOptional()
  @IsEnum(ActivityLevel)
  level?: ActivityLevel;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  entityType?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  entityId?: string;

  @ApiPropertyOptional({
    description:
      "A correspondent's history: what was done on it and on its effets (also what entityType=correspondent&entityId= returns)",
  })
  @IsOptional()
  @IsUUID()
  correspondentId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  userId?: string;

  @ApiPropertyOptional({
    description:
      "Only this site's entries — within the sites the caller may audit (every site for a platform administrator)",
  })
  @IsOptional()
  @IsUUID('4')
  siteId?: string;

  @ApiPropertyOptional({
    description: 'From this date-time (inclusive), ISO 8601',
    example: '2026-11-01',
  })
  @IsOptional()
  @IsDateString()
  from?: string;

  @ApiPropertyOptional({
    description:
      'Up to this date-time (exclusive); a date alone means up to the end of that day',
    example: '2026-11-30',
  })
  @IsOptional()
  @IsDateString()
  to?: string;

  @ApiPropertyOptional({
    description: `Comma-separated categories: ${AUDIT_CATEGORIES.join(', ')}`,
    example: 'approval,dispatching',
  })
  @IsOptional()
  @Transform(commaList)
  @IsArray()
  @IsIn(AUDIT_CATEGORIES, { each: true })
  category?: AuditCategory[];

  @ApiPropertyOptional({
    description:
      'Comma-separated actions, exact (e.g. COURRIER_VALIDE,role.updated)',
  })
  @IsOptional()
  @Transform(commaList)
  @IsArray()
  @ArrayMaxSize(50)
  @IsString({ each: true })
  action?: string[];

  @ApiPropertyOptional({ default: 0 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  skip?: number;

  @ApiPropertyOptional({ default: 20 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  take?: number;
}
