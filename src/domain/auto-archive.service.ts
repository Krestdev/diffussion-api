import {
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
 * PA·8 "archivage automatique après clôture": each site's effets closed
 * (an entrant), discharged (a sortant) or cancelled more than
 * autoArchiveAfterMonths months ago are archived — never deleted, and
 * restorable like any archived effet. Sites set to null: never.
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
      const sites = await this.database.site.findMany({ select: { id: true } });
      // Every site, and the effets of no site (the common settings).
      for (const siteId of [...sites.map((site) => site.id), null]) {
        const { autoArchiveAfterMonths } = await this.settings.get(siteId);
        if (!autoArchiveAfterMonths) continue;
        const archived = await this.archiveSite(
          siteId,
          monthsBefore(now, autoArchiveAfterMonths),
          autoArchiveAfterMonths,
          now,
        );
        if (archived) {
          this.logger.log(
            `${archived} effet(s) archived automatically (site ${siteId ?? '—'})`,
          );
        }
      }
    } catch (error) {
      this.logger.error('Automatic archiving failed', (error as Error).stack);
    }
  }

  // Returns how many effets of `siteId` were archived.
  async archiveSite(
    siteId: string | null,
    cutoff: Date,
    months: number,
    now: Date,
  ) {
    const ofSite: Prisma.CourrierWhereInput = siteId
      ? {
          OR: [
            { dossier: { siteId } },
            { dossierId: null, createdBy: { siteId } },
          ],
        }
      : {
          dossierId: null,
          OR: [{ createdById: null }, { createdBy: { siteId: null } }],
        };
    const reason = `Archivage automatique : ${months} mois après clôture`;
    let total = 0;
    for (const rule of ARCHIVABLE) {
      const due = await this.database.courrier.findMany({
        where: {
          ...ofSite,
          status: rule.status,
          ...(rule.direction ? { direction: rule.direction } : {}),
          [rule.since]: { lt: cutoff },
        },
        select: { id: true },
      });
      if (due.length === 0) continue;
      const ids = due.map((row) => row.id);
      // Guarded on the status read: an effet reopened meanwhile stays.
      const { count } = await this.database.courrier.updateMany({
        where: { id: { in: ids }, status: rule.status },
        data: {
          status: CourrierStatus.ARCHIVE,
          archivedAt: now,
          archiveReason: reason,
          archivedFromStatus: rule.status,
        },
      });
      total += count;
      // The audit journal, as the system's own action.
      await this.database.activityLog
        .createMany({
          data: ids.map((id) => ({
            source: 'SYSTEM' as const,
            level: 'info' as const,
            action: 'COURRIER_ARCHIVE_AUTO',
            entityType: 'Courrier',
            entityId: id,
            siteId,
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
