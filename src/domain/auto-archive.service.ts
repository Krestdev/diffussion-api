import {
  ConflictException,
  Injectable,
  Logger,
  OnApplicationBootstrap,
  OnModuleDestroy,
} from '@nestjs/common';
import {
  CourrierDirection,
  CourrierStatus,
  Prisma,
} from '../../generated/prisma/client';
import { SettingsService } from '../administration/settings/settings.service';
import { DatabaseService } from '../database/database.service';
import { WorkflowService } from '../workflow/workflow.service';
import { courrierStates } from './mail/courrier.states';

// Hourly: the job only archives what is due, so running it often is
// harmless and a restart never makes it miss a day.
const SWEEP_INTERVAL_MS = 60 * 60 * 1000;

// What archive() accepts, and since when the effet has been in that state.
const ARCHIVABLE: {
  status: CourrierStatus;
  direction?: CourrierDirection;
  since: 'closedAt' | 'dischargedAt' | 'cancelledAt';
}[] = [
  {
    status: CourrierStatus.CLOTURE,
    direction: CourrierDirection.ENTRANT,
    since: 'closedAt',
  },
  {
    status: CourrierStatus.DECHARGE,
    direction: CourrierDirection.SORTANT,
    since: 'dischargedAt',
  },
  { status: CourrierStatus.ANNULE, since: 'cancelledAt' },
];

/**
 * PA·8 "archivage automatique après clôture": each company's effets closed
 * (an entrant), discharged (a sortant) or cancelled more than
 * autoArchiveAfterMonths months ago are archived — never deleted, and
 * restorable like any archived effet. Companies set to null: never. Each
 * goes through the workflow engine (event AUTO_ARCHIVE, a system change),
 * so it lands in StatusHistory.
 */
@Injectable()
export class AutoArchiveService
  implements OnApplicationBootstrap, OnModuleDestroy
{
  private readonly logger = new Logger(AutoArchiveService.name);
  private timer?: NodeJS.Timeout;

  constructor(
    private readonly database: DatabaseService,
    private readonly settings: SettingsService,
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

  async sweep(now = new Date()) {
    try {
      const companies = await this.database.company.findMany({
        select: { id: true },
      });
      // Every company, and the effets of no company (the common settings).
      for (const companyId of [
        ...companies.map((company) => company.id),
        null,
      ]) {
        const { autoArchiveAfterMonths } = await this.settings.get(companyId);
        if (!autoArchiveAfterMonths) continue;
        const archived = await this.archiveCompany(
          companyId,
          monthsBefore(now, autoArchiveAfterMonths),
          autoArchiveAfterMonths,
          now,
        );
        if (archived) {
          this.logger.log(
            `${archived} effet(s) archived automatically (company ${companyId ?? '—'})`,
          );
        }
      }
    } catch (error) {
      this.logger.error('Automatic archiving failed', (error as Error).stack);
    }
  }

  // Returns how many effets of `companyId` were archived.
  async archiveCompany(
    companyId: string | null,
    cutoff: Date,
    months: number,
    now: Date,
  ) {
    const ofCompany: Prisma.CourrierWhereInput = companyId
      ? {
          OR: [
            { dossier: { companyId } },
            { dossierId: null, createdBy: { companyId } },
          ],
        }
      : {
          dossierId: null,
          OR: [{ createdById: null }, { createdBy: { companyId: null } }],
        };
    const reason = `Archivage automatique : ${months} mois après clôture`;
    let total = 0;
    for (const rule of ARCHIVABLE) {
      const due = await this.database.courrier.findMany({
        where: {
          ...ofCompany,
          status: rule.status,
          ...(rule.direction ? { direction: rule.direction } : {}),
          [rule.since]: { lt: cutoff },
        },
        select: { id: true, direction: true },
      });
      if (due.length === 0) continue;
      // One AUTO_ARCHIVE each, conditional on the status read: an effet
      // reopened meanwhile stays (its 409 is skipped).
      const ids: string[] = [];
      for (const effet of due) {
        try {
          await this.database.$transaction((tx) =>
            this.workflow.transition(tx, {
              table: courrierStates(effet.direction),
              delegate: tx.courrier,
              entityId: effet.id,
              event: 'AUTO_ARCHIVE',
              from: rule.status,
              reason,
              data: {
                archivedAt: now,
                archiveReason: reason,
                archivedFromStatus: rule.status,
              },
              system: true,
              companyId,
            }),
          );
          ids.push(effet.id);
        } catch (error) {
          if (!(error instanceof ConflictException)) throw error;
        }
      }
      total += ids.length;
      if (ids.length === 0) continue;
      // The audit journal, as the system's own action.
      await this.database.activityLog
        .createMany({
          data: ids.map((id) => ({
            source: 'SYSTEM' as const,
            level: 'info' as const,
            action: 'COURRIER_ARCHIVE_AUTO',
            entityType: 'Courrier',
            entityId: id,
            companyId,
            message: reason,
            metadata: { from: rule.status, months },
          })),
        })
        .catch(() => undefined);
    }
    return total;
  }
}

// `months` calendar months before `now`.
export function monthsBefore(now: Date, months: number) {
  const date = new Date(now);
  date.setUTCMonth(date.getUTCMonth() - months);
  return date;
}
