/**
 * The general settings (PA·5, PA·8) and their defaults — what a site gets
 * until the common settings or its own say otherwise.
 *
 * Several are only stored here for the front to apply (session warning,
 * reconnection, drafts kept on the device); the others are read by the
 * server where noted.
 */
export const OVERDUE_REMINDER_FREQUENCIES = [
  'DAILY',
  'EVERY_2_DAYS',
  'WEEKLY',
] as const;
export type OverdueReminderFrequency =
  (typeof OVERDUE_REMINDER_FREQUENCIES)[number];

export interface GeneralSettings {
  /** Most instructions in progress per agent; null: no limit. */
  maxActiveInstructionsPerAgent: number | null;
  // PA·8 — délais et rappels
  /** Days to treat an entrant (business days when businessDaysOnly). */
  defaultTreatmentDays: number;
  /** Days to answer with a sortant. */
  outgoingReplyDays: number;
  /** Days for a sortant's discharge to come back. */
  dischargeExpectedDays: number;
  /** Days before a deadline the reminder goes out. */
  reminderDaysBefore: number;
  /** How often an overdue item is reminded; null: once only. */
  overdueReminderFrequency: OverdueReminderFrequency | null;
  /** Months after closure an item is archived; null: never. */
  autoArchiveAfterMonths: number | null;
  /** Years the audit journal is kept. */
  auditRetentionYears: number;
  /** Delays count business days only. */
  businessDaysOnly: boolean;
  /** Reminders also go to the designated responsible. */
  remindDesignatedResponsible: boolean;
  // PA·5 — session
  sessionTimeoutMinutes: number;
  autoReconnectSeconds: number;
  warnBeforeSessionExpiry: boolean;
  keepDraftsOnDevice: boolean;
}

export type GeneralSettingKey = keyof GeneralSettings;

export const GENERAL_SETTINGS_DEFAULTS: GeneralSettings = {
  maxActiveInstructionsPerAgent: null,
  defaultTreatmentDays: 10,
  outgoingReplyDays: 15,
  dischargeExpectedDays: 8,
  reminderDaysBefore: 2,
  overdueReminderFrequency: 'DAILY',
  autoArchiveAfterMonths: null,
  auditRetentionYears: 10,
  businessDaysOnly: true,
  remindDesignatedResponsible: true,
  sessionTimeoutMinutes: 60,
  autoReconnectSeconds: 30,
  warnBeforeSessionExpiry: true,
  keepDraftsOnDevice: true,
};

export const GENERAL_SETTING_KEYS = Object.keys(
  GENERAL_SETTINGS_DEFAULTS,
) as GeneralSettingKey[];
