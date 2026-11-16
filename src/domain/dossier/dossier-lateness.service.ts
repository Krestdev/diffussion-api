import {
  ConflictException,
  Injectable,
  Logger,
  OnApplicationBootstrap,
  OnModuleDestroy,
} from '@nestjs/common';
import { DossierStatus } from '../../generated/prisma/client';
import { DatabaseService } from '../../database/database.service';
import { WorkflowService } from '../../workflow/workflow.service';
import { DOSSIER_STATES } from './dossier.states';

const SWEEP_INTERVAL_MS = 10 * 60 * 1000;

/**
 * Moves active dossiers whose due date has passed to LATE (MARK_LATE, a system change recorded
 * in StatusHistory). Runs at startup and every 10 minutes. Each change is conditional on the
 * status read, so several API instances running it concurrently is harmless: the loser of a
 * race skips the dossier. (Due-date edits are applied immediately by DossierService via
 * statusForDueDate; this only covers time passing.)
 */
@Injectable()
export class DossierLatenessService
  implements OnApplicationBootstrap, OnModuleDestroy
{
  private readonly logger = new Logger(DossierLatenessService.name);
  private timer?: NodeJS.Timeout;

  constructor(
    private readonly database: DatabaseService,
    private readonly workflow: WorkflowService,
  ) {}

  onApplicationBootstrap() {
    void this.sweep();
    this.timer = setInterval(() => void this.sweep(), SWEEP_INTERVAL_MS);
    this.timer.unref();
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  async sweep() {
    try {
      const overdue = await this.database.dossier.findMany({
        where: {
          dueDate: { lt: new Date() },
          status: {
            in: [
              DossierStatus.OPEN,
              DossierStatus.IN_PROGRESS,
              DossierStatus.PENDING,
            ],
          },
        },
        select: { id: true, status: true, companyId: true },
      });
      let count = 0;
      for (const dossier of overdue) {
        try {
          await this.database.$transaction((tx) =>
            this.workflow.transition(tx, {
              table: DOSSIER_STATES,
              delegate: tx.dossier,
              entityId: dossier.id,
              event: 'MARK_LATE',
              from: dossier.status,
              companyId: dossier.companyId,
              system: true,
            }),
          );
          count++;
        } catch (error) {
          // Changed in the meantime (another instance, a user): skipped.
          if (!(error instanceof ConflictException)) throw error;
        }
      }
      if (count > 0) {
        this.logger.log(`${count} dossier(s) marked LATE`);
      }
    } catch (error) {
      this.logger.error(
        'Dossier lateness sweep failed',
        (error as Error).stack,
      );
    }
  }
}
