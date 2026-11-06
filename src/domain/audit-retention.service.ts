import {
  Injectable,
  Logger,
  OnApplicationBootstrap,
  OnModuleDestroy,
} from '@nestjs/common';
import { Prisma } from '../../generated/prisma/client';
import { SettingsService } from '../administration/settings/settings.service';
import { DatabaseService } from '../database/database.service';
import { StorageService } from '../storage/storage.service';

// Every 6 hours: each run exports and deletes only what is past retention.
const SWEEP_INTERVAL_MS = 6 * 60 * 60 * 1000;
// Entries per CSV file, and files per site and run.
const BATCH = 5000;
const MAX_BATCHES = 20;
// Never less, whatever the settings say.
export const MIN_AUDIT_RETENTION_YEARS = 1;

const COLUMNS = [
  'id',
  'createdAt',
  'siteId',
  'userId',
  'actorLabel',
  'source',
  'level',
  'action',
  'entityType',
  'entityId',
  'message',
  'ip',
  'parentLogId',
  'metadata',
] as const;

type Entry = Prisma.ActivityLogGetPayload<object>;

/**
 * PA·8 "conservation du journal d'audit": each site's entries older than
 * its auditRetentionYears (1 year at least) are first exported as CSV to
 * the file storage — recorded in AuditArchive, downloadable — then deleted,
 * batch by batch, and only once their file is safely stored. The
 * platform's own entries (no site) follow the common settings.
 */
@Injectable()
export class AuditRetentionService
  implements OnApplicationBootstrap, OnModuleDestroy
{
  private readonly logger = new Logger(AuditRetentionService.name);
  private timer?: NodeJS.Timeout;

  constructor(
    private readonly database: DatabaseService,
    private readonly settings: SettingsService,
    private readonly storage: StorageService,
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
      for (const siteId of [...sites.map((site) => site.id), null]) {
        const { auditRetentionYears } = await this.settings.get(siteId);
        const years = Math.max(
          MIN_AUDIT_RETENTION_YEARS,
          auditRetentionYears || MIN_AUDIT_RETENTION_YEARS,
        );
        const purged = await this.purgeSite(siteId, years, now);
        if (purged) {
          this.logger.log(
            `${purged} audit entr(ies) exported then deleted (site ${siteId ?? '—'}, ${years} year(s))`,
          );
        }
      }
    } catch (error) {
      this.logger.error('Audit retention failed', (error as Error).stack);
    }
  }

  // Returns how many entries of `siteId` were exported then deleted.
  async purgeSite(siteId: string | null, years: number, now: Date) {
    const cutoff = new Date(now);
    cutoff.setUTCFullYear(cutoff.getUTCFullYear() - years);
    let total = 0;
    for (let batch = 0; batch < MAX_BATCHES; batch++) {
      const entries = await this.database.activityLog.findMany({
        where: { siteId, createdAt: { lt: cutoff } },
        orderBy: { createdAt: 'asc' },
        take: BATCH,
      });
      if (entries.length === 0) break;

      // Stored first: nothing is deleted without its file.
      const from = entries[0].createdAt;
      const to = entries[entries.length - 1].createdAt;
      const name = `journal-${siteId ?? 'plateforme'}-${stamp(from)}-${stamp(to)}.csv`;
      const { key } = await this.storage.upload(Buffer.from(toCsv(entries)), {
        originalName: name,
        contentType: 'text/csv',
        prefix: `audit-archives/${siteId ?? 'platform'}`,
      });
      const archive = await this.database.auditArchive.create({
        data: {
          siteId,
          storageKey: key,
          fromDate: from,
          toDate: to,
          entries: entries.length,
          retentionYears: years,
        },
      });
      const { count } = await this.database.activityLog.deleteMany({
        where: { id: { in: entries.map((entry) => entry.id) } },
      });
      total += count;
      // The trace in the journal itself, as the system's own action.
      await this.database.activityLog
        .create({
          data: {
            source: 'SYSTEM',
            level: 'info',
            action: 'audit.purged',
            entityType: 'audit-archive',
            entityId: archive.id,
            siteId,
            message: `${count} entrée(s) du journal antérieures au ${stamp(cutoff)} exportées puis supprimées (conservation : ${years} an(s))`,
            metadata: { entries: count, from, to, file: key },
          },
        })
        .catch(() => undefined);
      if (entries.length < BATCH) break;
    }
    return total;
  }
}

function toCsv(entries: Entry[]) {
  const lines = entries.map((entry) =>
    COLUMNS.map((column) => cell(entry[column])).join(';'),
  );
  // BOM: Excel reads the accents right.
  return '﻿' + [COLUMNS.join(';'), ...lines].join('\r\n');
}

function cell(value: unknown): string {
  if (value === null || value === undefined) return '';
  const text =
    value instanceof Date
      ? value.toISOString()
      : typeof value === 'string'
        ? value
        : typeof value === 'number' || typeof value === 'boolean'
          ? String(value)
          : JSON.stringify(value);
  return /[";\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function stamp(date: Date) {
  return date.toISOString().slice(0, 10);
}
