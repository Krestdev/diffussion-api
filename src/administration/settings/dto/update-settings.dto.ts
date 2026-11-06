import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsUUID,
  Max,
  Min,
  ValidateIf,
} from 'class-validator';
import {
  GENERAL_SETTING_KEYS,
  OVERDUE_REMINDER_FREQUENCIES,
  type GeneralSettingKey,
  type OverdueReminderFrequency,
} from '../settings.defaults';

const nullable = ValidateIf((_, value) => value !== null);

export class SettingsQueryDto {
  @ApiPropertyOptional({
    description:
      "This site's settings (its own, else the common ones). Left out: the caller's own site's — the common ones for a platform user",
  })
  @IsOptional()
  @IsUUID('4')
  siteId?: string;
}

export class UpdateSettingsDto {
  @ApiPropertyOptional({
    description:
      "Set this site's settings. Left out: the caller's site when they manage only one; the common settings for a platform administrator",
  })
  @IsOptional()
  @IsUUID('4')
  siteId?: string;

  @ApiPropertyOptional({
    type: [String],
    description:
      'Settings this site gives up, to inherit the common value again',
  })
  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @IsIn(GENERAL_SETTING_KEYS, { each: true })
  reset?: GeneralSettingKey[];

  @ApiPropertyOptional({
    type: Number,
    nullable: true,
    minimum: 1,
    description:
      'Most instructions in progress an agent should carry at once; null for no limit',
  })
  @IsOptional()
  @nullable
  @IsInt()
  @Min(1)
  @Max(1000)
  maxActiveInstructionsPerAgent?: number | null;

  // ---------------------------------------------------------------- PA·8

  @ApiPropertyOptional({ minimum: 1, description: 'Business days' })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(365)
  defaultTreatmentDays?: number;

  @ApiPropertyOptional({ minimum: 1, description: 'Business days' })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(365)
  outgoingReplyDays?: number;

  @ApiPropertyOptional({ minimum: 1, description: 'Business days' })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(365)
  dischargeExpectedDays?: number;

  @ApiPropertyOptional({ minimum: 0, description: 'Days before a deadline' })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(60)
  reminderDaysBefore?: number;

  @ApiPropertyOptional({
    enum: OVERDUE_REMINDER_FREQUENCIES,
    nullable: true,
    description: 'null: an overdue item is reminded once only',
  })
  @IsOptional()
  @nullable
  @IsIn(OVERDUE_REMINDER_FREQUENCIES)
  overdueReminderFrequency?: OverdueReminderFrequency | null;

  @ApiPropertyOptional({
    type: Number,
    nullable: true,
    description: 'Months after closure; null: never',
  })
  @IsOptional()
  @nullable
  @IsInt()
  @Min(1)
  @Max(600)
  autoArchiveAfterMonths?: number | null;

  @ApiPropertyOptional({ minimum: 1 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(100)
  auditRetentionYears?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  businessDaysOnly?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  remindDesignatedResponsible?: boolean;

  // ---------------------------------------------------------------- PA·5

  @ApiPropertyOptional({ minimum: 5 })
  @IsOptional()
  @IsInt()
  @Min(5)
  @Max(1440)
  sessionTimeoutMinutes?: number;

  @ApiPropertyOptional({ minimum: 0 })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(3600)
  autoReconnectSeconds?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  warnBeforeSessionExpiry?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  keepDraftsOnDevice?: boolean;
}
