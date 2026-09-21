import {
  Injectable,
  Logger,
  OnApplicationBootstrap,
  OnModuleDestroy,
} from '@nestjs/common';
import { DossierStatus } from '../../../generated/prisma/client';
import { DatabaseService } from '../../database/database.service';

const SWEEP_INTERVAL_MS = 10 * 60 * 1000;

/**
 * Moves active dossiers whose due date has passed to LATE. Runs at startup
 * and every 10 minutes. The update is idempotent, so several API instances
 * running it concurrently is harmless. (Due-date edits are applied
 * immediately by DossierService via statusForDueDate; this only covers
 * time passing.)
 */
@Injectable()
export class DossierLatenessService
  implements OnApplicationBootstrap, OnModuleDestroy
{
  private readonly logger = new Logger(DossierLatenessService.name);
  private timer?: NodeJS.Timeout;

  constructor(private readonly database: DatabaseService) {}

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
      const { count } = await this.database.dossier.updateMany({
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
        data: { status: DossierStatus.LATE },
      });
      if (count > 0) {
        this.logger.log(`${count} dossier(s) marked LATE`);
      }
    } catch (error) {
      this.logger.error('Dossier lateness sweep failed', (error as Error).stack);
    }
  }
}
