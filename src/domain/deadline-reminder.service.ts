import {
  Injectable,
  Logger,
  OnApplicationBootstrap,
  OnModuleDestroy,
} from '@nestjs/common';
import {
  CourrierDirection,
  CourrierStatus,
  NotificationCanal,
  Prisma,
  UserInstructionRole,
} from '../../generated/prisma/client';
import { SettingsService } from '../administration/settings/settings.service';
import type {
  GeneralSettings,
  OverdueReminderFrequency,
} from '../administration/settings/settings.defaults';
import { DatabaseService } from '../database/database.service';
import { taskOverdueWhere } from '../instructions/instruction-overdue';
import { NotificationsService } from '../notifications/notifications.service';
import { RbacService } from '../auth/rbac/rbac.service';

const SWEEP_INTERVAL_MS = 10 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

const FREQUENCY_MS: Record<OverdueReminderFrequency, number> = {
  DAILY: DAY_MS,
  EVERY_2_DAYS: 2 * DAY_MS,
  WEEKLY: 7 * DAY_MS,
};

// An entrant still being treated; a sortant not sent yet.
const COURRIER_PENDING: CourrierStatus[] = [
  CourrierStatus.RECU,
  CourrierStatus.ENREGISTRE,
  CourrierStatus.EN_ATTENTE_TRANSMISSION,
  CourrierStatus.AFFECTE,
  CourrierStatus.TRANSMIS,
  CourrierStatus.EN_TRAITEMENT,
  CourrierStatus.BROUILLON,
  CourrierStatus.EN_ATTENTE_VALIDATION,
  CourrierStatus.A_CORRIGER,
  CourrierStatus.VALIDE,
  CourrierStatus.SIGNE,
  CourrierStatus.PRET_A_ENVOYER,
];

const courrierSelect = {
  id: true,
  number: true,
  subject: true,
  direction: true,
  dossierId: true,
  ownerId: true,
  supervisorId: true,
  createdById: true,
  transmittedById: true,
  dueDate: true,
  supervisorDueDate: true,
  dischargeDueDate: true,
  overdueRemindedAt: true,
  dischargeRemindedAt: true,
  dossier: { select: { siteId: true } },
  createdBy: { select: { siteId: true } },
} satisfies Prisma.CourrierSelect;
type CourrierRow = Prisma.CourrierGetPayload<{ select: typeof courrierSelect }>;

const taskSelect = {
  id: true,
  title: true,
  dossierId: true,
  courrierId: true,
  createdById: true,
  dueDate: true,
  overdueRemindedAt: true,
  overdueNotifiedAt: true,
  assignees: { select: { userId: true, role: true } },
  courrier: { select: { ownerId: true } },
} satisfies Prisma.InstructionSelect;

/**
 * The PA·8 reminders, by each object's site settings:
 *  - before a deadline (reminderDaysBefore): an effet's, a task's — once;
 *  - once overdue: an effet's deadline, a sortant's discharge, then again
 *    every overdueReminderFrequency (never again when null) — tasks get
 *    their first overdue alert from InstructionLatenessService, relaunched
 *    here;
 *  - the effet's designated responsible too when remindDesignatedResponsible.
 * Runs at startup and every 10 minutes; each alert is claimed in the
 * database first (a guarded update), so several API instances never send
 * it twice. Moving a deadline clears its claims.
 */
@Injectable()
export class DeadlineReminderService
  implements OnApplicationBootstrap, OnModuleDestroy
{
  private readonly logger = new Logger(DeadlineReminderService.name);
  private timer?: NodeJS.Timeout;

  constructor(
    private readonly database: DatabaseService,
    private readonly notifications: NotificationsService,
    private readonly settings: SettingsService,
    private readonly rbac: RbacService,
  ) {}

  onApplicationBootstrap() {
    void this.sweep();
    this.timer = setInterval(() => void this.sweep(), SWEEP_INTERVAL_MS);
    this.timer.unref();
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  async sweep(now = new Date()) {
    // One read of each site's settings per sweep.
    const cache = new Map<string | null, Promise<GeneralSettings>>();
    const settingsOf = (siteId: string | null) => {
      if (!cache.has(siteId)) cache.set(siteId, this.settings.get(siteId));
      return cache.get(siteId)!;
    };
    for (const [label, step] of [
      ['effets due soon', () => this.courriersDueSoon(now, settingsOf)],
      ['effets overdue', () => this.courriersOverdue(now, settingsOf)],
      ['discharges late', () => this.dischargesLate(now, settingsOf)],
      ['tasks due soon', () => this.tasksDueSoon(now, settingsOf)],
      ['tasks overdue', () => this.tasksOverdue(now, settingsOf)],
    ] as const) {
      try {
        await step();
      } catch (error) {
        this.logger.error(
          `Deadline reminders (${label}) failed`,
          (error as Error).stack,
        );
      }
    }
  }

  // ---------------------------------------------------------------- effets

  private async courriersDueSoon(
    now: Date,
    settingsOf: (siteId: string | null) => Promise<GeneralSettings>,
  ) {
    // The widest window any site may use; each site's is checked below.
    const horizon = new Date(now.getTime() + 61 * DAY_MS);
    const rows = await this.database.courrier.findMany({
      where: {
        status: { in: COURRIER_PENDING },
        dueReminderSentAt: null,
        OR: [
          { supervisorDueDate: { gte: now, lte: horizon } },
          { supervisorDueDate: null, dueDate: { gte: now, lte: horizon } },
        ],
      },
      select: courrierSelect,
    });
    for (const row of rows) {
      const settings = await settingsOf(courrierSite(row));
      const deadline = (row.supervisorDueDate ?? row.dueDate)!;
      if (!withinDays(now, deadline, settings.reminderDaysBefore)) continue;
      const { count } = await this.database.courrier.updateMany({
        where: { id: row.id, dueReminderSentAt: null },
        data: { dueReminderSentAt: now },
      });
      if (count !== 1) continue;
      this.send(courrierRecipients(row, false), {
        type: 'COURRIER_DUE_SOON',
        message: `L'échéance de l'effet ${row.number} « ${row.subject} » arrive le ${day(deadline)}.`,
        courrierId: row.id,
        dossierId: row.dossierId,
      });
    }
  }

  private async courriersOverdue(
    now: Date,
    settingsOf: (siteId: string | null) => Promise<GeneralSettings>,
  ) {
    const rows = await this.database.courrier.findMany({
      where: {
        status: { in: COURRIER_PENDING },
        OR: [
          { supervisorDueDate: { lt: now } },
          { supervisorDueDate: null, dueDate: { lt: now } },
        ],
      },
      select: courrierSelect,
    });
    for (const row of rows) {
      const settings = await settingsOf(courrierSite(row));
      if (!isDue(row.overdueRemindedAt, now, settings)) continue;
      if (!(await this.claimCourrier(row, 'overdueRemindedAt', now))) continue;
      const deadline = (row.supervisorDueDate ?? row.dueDate)!;
      this.send(courrierRecipients(row, settings.remindDesignatedResponsible), {
        type: 'COURRIER_OVERDUE',
        message: `${row.overdueRemindedAt ? 'Relance : l' : 'L'}'échéance de l'effet ${row.number} « ${row.subject} » est dépassée (${day(deadline)}).`,
        courrierId: row.id,
        dossierId: row.dossierId,
      });
    }
  }

  private async dischargesLate(
    now: Date,
    settingsOf: (siteId: string | null) => Promise<GeneralSettings>,
  ) {
    const rows = await this.database.courrier.findMany({
      where: {
        direction: CourrierDirection.SORTANT,
        status: CourrierStatus.ENVOYE,
        dischargeDueDate: { lt: now },
      },
      select: courrierSelect,
    });
    for (const row of rows) {
      const settings = await settingsOf(courrierSite(row));
      if (!isDue(row.dischargeRemindedAt, now, settings)) continue;
      if (!(await this.claimCourrier(row, 'dischargeRemindedAt', now))) {
        continue;
      }
      this.send(
        [
          row.createdById,
          row.transmittedById,
          settings.remindDesignatedResponsible ? row.ownerId : null,
        ],
        {
          type: 'COURRIER_DISCHARGE_OVERDUE',
          message: `${row.dischargeRemindedAt ? 'Relance : l' : 'L'}a décharge de l'effet sortant ${row.number} « ${row.subject} » était attendue le ${day(row.dischargeDueDate)}.`,
          courrierId: row.id,
          dossierId: row.dossierId,
        },
      );
    }
  }

  // Claimed against the value read: a concurrent sweep that sent it
  // meanwhile wins.
  private async claimCourrier(
    row: CourrierRow,
    field: 'overdueRemindedAt' | 'dischargeRemindedAt',
    now: Date,
  ) {
    const { count } = await this.database.courrier.updateMany({
      where: { id: row.id, [field]: row[field] },
      data: { [field]: now },
    });
    return count === 1;
  }

  // ----------------------------------------------------------------- tasks

  private async tasksDueSoon(
    now: Date,
    settingsOf: (siteId: string | null) => Promise<GeneralSettings>,
  ) {
    const horizon = new Date(now.getTime() + 61 * DAY_MS);
    const rows = await this.database.instruction.findMany({
      where: {
        dueReminderSentAt: null,
        dueDate: { gte: now, lte: horizon },
        status: { notIn: ['TERMINEE', 'ANNULEE'] },
      },
      select: taskSelect,
    });
    for (const row of rows) {
      const settings = await settingsOf(await this.taskSite(row.id));
      if (!withinDays(now, row.dueDate!, settings.reminderDaysBefore)) continue;
      const { count } = await this.database.instruction.updateMany({
        where: { id: row.id, dueReminderSentAt: null },
        data: { dueReminderSentAt: now },
      });
      if (count !== 1) continue;
      this.send(
        row.assignees
          .filter((a) => a.role !== UserInstructionRole.VALIDATEUR)
          .map((a) => a.userId),
        {
          type: 'TASK_DUE_SOON',
          message: `L'échéance de la tâche « ${row.title} » arrive le ${day(row.dueDate)}.`,
          instructionId: row.id,
          courrierId: row.courrierId,
          dossierId: row.dossierId,
        },
      );
    }
  }

  // The first overdue alert is InstructionLatenessService's; the relaunches
  // after it are sent here.
  private async tasksOverdue(
    now: Date,
    settingsOf: (siteId: string | null) => Promise<GeneralSettings>,
  ) {
    const rows = await this.database.instruction.findMany({
      where: { ...taskOverdueWhere(now), overdueNotifiedAt: { not: null } },
      select: taskSelect,
    });
    for (const row of rows) {
      const settings = await settingsOf(await this.taskSite(row.id));
      const last = row.overdueRemindedAt ?? row.overdueNotifiedAt;
      if (!settings.overdueReminderFrequency) continue;
      if (
        now.getTime() - last!.getTime() <
        FREQUENCY_MS[settings.overdueReminderFrequency]
      ) {
        continue;
      }
      const { count } = await this.database.instruction.updateMany({
        where: { id: row.id, overdueRemindedAt: row.overdueRemindedAt },
        data: { overdueRemindedAt: now },
      });
      if (count !== 1) continue;
      this.send(
        [
          ...row.assignees
            .filter((a) => a.role !== UserInstructionRole.VALIDATEUR)
            .map((a) => a.userId),
          row.createdById,
          settings.remindDesignatedResponsible
            ? (row.courrier?.ownerId ?? null)
            : null,
        ],
        {
          type: 'TASK_OVERDUE',
          message: `Relance : la date limite de la tâche « ${row.title} » est dépassée (${day(row.dueDate)}).`,
          instructionId: row.id,
          courrierId: row.courrierId,
          dossierId: row.dossierId,
        },
      );
    }
  }

  private async taskSite(id: string) {
    return (await this.rbac.resolveSiteId('instruction', id)) ?? null;
  }

  // ------------------------------------------------------------------ send

  private send(
    recipients: (string | null)[],
    content: {
      type: string;
      message: string;
      courrierId: string | null;
      dossierId: string | null;
      instructionId?: string;
    },
  ) {
    const recipientIds = [
      ...new Set(recipients.filter((id): id is string => Boolean(id))),
    ];
    if (recipientIds.length === 0) return;
    this.notifications
      .create({
        recipientIds,
        type: content.type,
        message: content.message,
        canal: NotificationCanal.IN_APP,
        courrierId: content.courrierId ?? undefined,
        dossierId: content.dossierId ?? undefined,
        instructionId: content.instructionId,
      })
      .catch((error: unknown) => {
        this.logger.error('Failed to send a reminder', error as Error);
      });
  }
}

// An effet's site: its dossier's, else its registrant's.
function courrierSite(row: CourrierRow): string | null {
  return row.dossier?.siteId ?? row.createdBy?.siteId ?? null;
}

// Who hears about an effet's deadline: its supervisor (else its designated
// responsible), a sortant's author, and its designated responsible too when
// the site says so.
function courrierRecipients(row: CourrierRow, alsoResponsible: boolean) {
  return [
    row.supervisorId ?? row.ownerId,
    row.direction === CourrierDirection.SORTANT ? row.createdById : null,
    alsoResponsible ? row.ownerId : null,
  ];
}

// The deadline falls within the next `days` days (0: no reminder).
function withinDays(now: Date, deadline: Date, days: number) {
  return days > 0 && deadline.getTime() - now.getTime() <= days * DAY_MS;
}

// Never alerted yet; or alerted, relaunched every `frequency` (never when
// null).
function isDue(last: Date | null, now: Date, settings: GeneralSettings) {
  if (!last) return true;
  const frequency = settings.overdueReminderFrequency;
  if (!frequency) return false;
  return now.getTime() - last.getTime() >= FREQUENCY_MS[frequency];
}

function day(date: Date | null) {
  return date ? date.toLocaleDateString('fr-FR') : '';
}
