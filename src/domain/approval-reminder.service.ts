import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import {
  CourrierDirection,
  CourrierStatus,
  LivrableStatus,
  NotificationCanal,
} from '../generated/prisma/client';
import { AppConfigService } from '../config/app-config.service';
import { DatabaseService } from '../database/database.service';
import { validationChain } from '../instructions/instructions.service';
import { NotificationsService } from '../notifications/notifications.service';
import { MailService } from './mail/mail.service';

const DAY = 86_400_000;

/** One validation waiting for a decision: the item, who decides, since when. */
type Stalled = {
  /** Unique per waiting round (the item and since when it waits). */
  key: string;
  userIds: (string | null | undefined)[];
  since: Date;
  params: Record<string, string>;
  message: string;
  courrierId?: string;
  dossierId?: string | null;
  instructionId?: string;
};

/**
 * Reminders of stalled validations, as EXPENZO's RemindersService (REMINDER_APPROVAL_STALLED):
 *  - an outgoing effet awaiting its validator's decision (EN_ATTENTE_VALIDATION) — its validator;
 *  - a proposed dispatching awaiting validation (EN_ATTENTE_TRANSMISSION) — whoever may validate
 *    a dispatching in the effet's company;
 *  - a submitted deliverable (SOUMIS, EN_VALIDATION) — the task's validateur while their opinion
 *    is awaited, else the one who decides (its superviseur, else its creator).
 * Each is reminded once it has waited REMINDER_AFTER_DAYS days, then again every
 * REMINDER_AFTER_DAYS days. Runs hourly; idempotent (one notification per item, waiting round
 * and period, by its sourceKey), so a second run or a second API instance sends nothing twice.
 * The deadline reminders (due soon, overdue, discharge) stay DeadlineReminderService's.
 */
@Injectable()
export class ApprovalReminderService {
  private readonly logger = new Logger(ApprovalReminderService.name);

  constructor(
    private readonly database: DatabaseService,
    private readonly notifications: NotificationsService,
    private readonly mail: MailService,
    private readonly config: AppConfigService,
  ) {}

  @Cron('0 * * * *')
  async hourly(): Promise<void> {
    if (this.config.get('NODE_ENV') === 'test') return;
    try {
      await this.run();
    } catch (error) {
      this.logger.error(
        'Approval reminders failed',
        error instanceof Error ? error.stack : String(error),
      );
    }
  }

  /** Creates the reminders due at `now`; returns how many notifications were created. */
  async run(now = new Date()): Promise<number> {
    const every = this.config.get('REMINDER_AFTER_DAYS');
    const before = new Date(now.getTime() - every * DAY);
    const due = [
      ...(await this.outgoingValidations(before)),
      ...(await this.dispatchValidations(before)),
      ...(await this.deliverableValidations(before)),
    ];
    let created = 0;
    for (const item of due) {
      const days = Math.floor((now.getTime() - item.since.getTime()) / DAY);
      if (days < every) continue;
      // One reminder per period of `every` days.
      const period = Math.floor(days / every);
      const recipientIds = [
        ...new Set(item.userIds.filter((id): id is string => Boolean(id))),
      ];
      if (recipientIds.length === 0) continue;
      try {
        const notification = await this.notifications.create(
          {
            recipientIds,
            type: 'REMINDER_APPROVAL_STALLED',
            message: `${item.message} (depuis ${days} jour${days > 1 ? 's' : ''})`,
            canal: NotificationCanal.IN_APP,
            params: { ...item.params, days: String(days) },
            courrierId: item.courrierId,
            dossierId: item.dossierId ?? undefined,
            instructionId: item.instructionId,
          },
          `reminder:${item.key}:${period}`,
        );
        if (notification) created++;
      } catch (error) {
        this.logger.error(
          `Reminder ${item.key} failed`,
          error instanceof Error ? error.stack : String(error),
        );
      }
    }
    return created;
  }

  private async outgoingValidations(before: Date): Promise<Stalled[]> {
    const rows = await this.database.courrier.findMany({
      where: {
        direction: CourrierDirection.SORTANT,
        status: CourrierStatus.EN_ATTENTE_VALIDATION,
        OR: [
          { submittedAt: { lt: before } },
          { submittedAt: null, updatedAt: { lt: before } },
        ],
      },
      select: {
        id: true,
        number: true,
        subject: true,
        dossierId: true,
        contractId: true,
        projectId: true,
        createdById: true,
        submittedAt: true,
        updatedAt: true,
      },
    });
    const due: Stalled[] = [];
    for (const row of rows) {
      const since = row.submittedAt ?? row.updatedAt;
      due.push({
        key: `courrier-validation:${row.id}:${since.getTime()}`,
        userIds: [await this.mail.validatorOf(row)],
        since,
        params: { reference: row.number, title: row.subject },
        message: `« ${row.subject} » attend votre validation`,
        courrierId: row.id,
        dossierId: row.dossierId,
      });
    }
    return due;
  }

  private async dispatchValidations(before: Date): Promise<Stalled[]> {
    const rows = await this.database.courrier.findMany({
      where: {
        status: CourrierStatus.EN_ATTENTE_TRANSMISSION,
        OR: [
          { proposedAt: { lt: before } },
          { proposedAt: null, updatedAt: { lt: before } },
        ],
      },
      select: {
        id: true,
        number: true,
        subject: true,
        dossierId: true,
        createdById: true,
        proposedById: true,
        proposedAt: true,
        updatedAt: true,
      },
    });
    const due: Stalled[] = [];
    for (const row of rows) {
      const since = row.proposedAt ?? row.updatedAt;
      // The one who proposed it is not asked to validate their own proposal.
      const validators = (await this.mail.dispatchValidatorsOf(row)).filter(
        (id) => id !== row.proposedById,
      );
      due.push({
        key: `dispatch-validation:${row.id}:${since.getTime()}`,
        userIds: validators,
        since,
        params: { reference: row.number, title: row.subject },
        message: `Le dispatching de « ${row.subject} » attend sa validation`,
        courrierId: row.id,
        dossierId: row.dossierId,
      });
    }
    return due;
  }

  private async deliverableValidations(before: Date): Promise<Stalled[]> {
    const rows = await this.database.livrable.findMany({
      where: {
        isLatest: true,
        status: { in: [LivrableStatus.SOUMIS, LivrableStatus.EN_VALIDATION] },
        updatedAt: { lt: before },
      },
      select: {
        id: true,
        title: true,
        validationStep: true,
        updatedAt: true,
        instruction: {
          select: {
            id: true,
            number: true,
            title: true,
            status: true,
            dossierId: true,
            courrierId: true,
            createdById: true,
            assignees: {
              select: { role: true, user: { select: { id: true } } },
            },
          },
        },
      },
    });
    return rows
      .filter(
        (row) =>
          row.instruction.status !== 'ANNULEE' &&
          row.instruction.status !== 'TERMINEE',
      )
      .map((row) => {
        const chain = validationChain(row.instruction);
        // The validateur gives their opinion first; then (or without one) the superviseur decides.
        const decider =
          chain.validateur && row.validationStep === 0
            ? chain.validateur
            : chain.decider;
        return {
          key: `deliverable-validation:${row.id}:${row.updatedAt.getTime()}`,
          userIds: [decider],
          since: row.updatedAt,
          params: {
            reference: row.instruction.number,
            title: row.title,
          },
          message: `Le livrable « ${row.title} » (tâche « ${row.instruction.title} ») attend votre décision`,
          dossierId: row.instruction.dossierId,
          courrierId: row.instruction.courrierId ?? undefined,
          instructionId: row.instruction.id,
        };
      });
  }
}
