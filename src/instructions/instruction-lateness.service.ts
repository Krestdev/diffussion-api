import {
  Injectable,
  Logger,
  OnApplicationBootstrap,
  OnModuleDestroy,
} from '@nestjs/common';
import {
  NotificationCanal,
  UserInstructionRole,
} from '../../generated/prisma/client';
import { DatabaseService } from '../database/database.service';
import { NotificationsService } from '../notifications/notifications.service';
import { agentOverdueWhere, taskOverdueWhere } from './instruction-overdue';

const SWEEP_INTERVAL_MS = 10 * 60 * 1000;

const sweepSelect = {
  id: true,
  title: true,
  dossierId: true,
  courrierId: true,
  createdById: true,
  dueDate: true,
  agentDueDate: true,
  assignees: { select: { userId: true, role: true } },
} as const;

/**
 * Sends each overdue alert once: to the executants and their superviseur
 * when the executants' deadline passes, to the superviseur and the creator
 * when the task's deadline passes. Runs at startup and every 10 minutes,
 * like DossierLatenessService. Each alert is claimed with a guarded update
 * first, so several API instances never send it twice. Moving a deadline
 * clears its claim (InstructionsService).
 */
@Injectable()
export class InstructionLatenessService
  implements OnApplicationBootstrap, OnModuleDestroy
{
  private readonly logger = new Logger(InstructionLatenessService.name);
  private timer?: NodeJS.Timeout;

  constructor(
    private readonly database: DatabaseService,
    private readonly notifications: NotificationsService,
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
    try {
      const agentOverdue = await this.database.instruction.findMany({
        where: { ...agentOverdueWhere(now), agentOverdueNotifiedAt: null },
        select: sweepSelect,
      });
      for (const task of agentOverdue) {
        if (!(await this.claim(task.id, 'agentOverdueNotifiedAt', now)))
          continue;
        this.send(task, () => true, {
          type: 'TASK_OVERDUE_AGENT',
          message: `La date limite d'exécution de la tâche « ${task.title} » est dépassée (${formatDate(task.agentDueDate)}).`,
        });
      }

      const taskOverdue = await this.database.instruction.findMany({
        where: { ...taskOverdueWhere(now), overdueNotifiedAt: null },
        select: sweepSelect,
      });
      for (const task of taskOverdue) {
        if (!(await this.claim(task.id, 'overdueNotifiedAt', now))) continue;
        this.send(
          task,
          (role) => role === UserInstructionRole.SUPERVISEUR,
          {
            type: 'TASK_OVERDUE',
            message: `La date limite de la tâche « ${task.title} » est dépassée (${formatDate(task.dueDate)}) et elle n'est pas validée.`,
          },
          [task.createdById],
        );
      }
    } catch (error) {
      this.logger.error(
        'Instruction lateness sweep failed',
        (error as Error).stack,
      );
    }
  }

  private async claim(
    id: string,
    field: 'agentOverdueNotifiedAt' | 'overdueNotifiedAt',
    now: Date,
  ) {
    const { count } = await this.database.instruction.updateMany({
      where: { id, [field]: null },
      data: { [field]: now },
    });
    return count === 1;
  }

  private send(
    task: {
      id: string;
      dossierId: string;
      courrierId: string | null;
      assignees: { userId: string; role: UserInstructionRole }[];
    },
    roleFilter: (role: UserInstructionRole) => boolean,
    content: { type: string; message: string },
    extra: (string | null)[] = [],
  ) {
    const recipientIds = [
      ...new Set(
        [
          ...task.assignees
            .filter((a) => roleFilter(a.role))
            .map((a) => a.userId),
          ...extra,
        ].filter((id): id is string => Boolean(id)),
      ),
    ];
    if (recipientIds.length === 0) return;
    this.notifications
      .create({
        recipientIds,
        ...content,
        canal: NotificationCanal.IN_APP,
        dossierId: task.dossierId,
        courrierId: task.courrierId ?? undefined,
      })
      .catch((error: unknown) => {
        this.logger.error('Failed to send an overdue alert', error as Error);
      });
  }
}

function formatDate(date: Date | null) {
  return date ? date.toLocaleDateString('fr-FR') : '';
}
