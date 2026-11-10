import { ForbiddenException, Injectable } from '@nestjs/common';
import {
  CourrierDirection,
  CourrierStatus,
  InstructionStatus,
  Prisma,
} from '../../generated/prisma/client';
import { PermissionCode } from '../auth/rbac/rbac.constants';
import { RbacService, SiteScopeList } from '../auth/rbac/rbac.service';
import { awaitingValidationBy } from '../common/utils/courrier-validation';
import { overdueWhere } from '../instructions/instruction-overdue';
import { visibleDossierWhere } from '../common/utils/dossier-visibility';
import { DatabaseService } from '../database/database.service';
import {
  DashboardStatsQueryDto,
  TrendPeriod,
} from './dto/dashboard-stats.query.dto';

const DAY_MS = 24 * 60 * 60 * 1000;

// An entrant no longer in progress.
const INCOMING_DONE: CourrierStatus[] = [
  CourrierStatus.CLOTURE,
  CourrierStatus.ARCHIVE,
  CourrierStatus.ANNULE,
];

// The offset (ms) of `timeZone` from UTC at the instant `at`.
function zoneOffset(at: number, timeZone: string): number {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    })
      .formatToParts(at)
      .map((part) => [part.type, part.value]),
  );
  const asUtc = Date.UTC(
    +parts.year,
    +parts.month - 1,
    +parts.day,
    +parts.hour,
    +parts.minute,
    +parts.second,
  );
  return asUtc - Math.floor(at / 1000) * 1000;
}

// The instant of local midnight, in `timeZone`, of the calendar day
// (year, month 0-11, day — overflow allowed, e.g. day 0 or month -1).
export function zonedMidnight(
  year: number,
  month: number,
  day: number,
  timeZone: string,
): Date {
  const guess = Date.UTC(year, month, day);
  const first = guess - zoneOffset(guess, timeZone);
  return new Date(guess - zoneOffset(first, timeZone));
}

// Today's calendar date in `timeZone`, and its weekday (0 = Monday).
export function localToday(now: number, timeZone: string) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      weekday: 'short',
    })
      .formatToParts(now)
      .map((part) => [part.type, part.value]),
  );
  const weekday = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].indexOf(
    parts.weekday,
  );
  return {
    year: +parts.year,
    month: +parts.month - 1,
    day: +parts.day,
    weekday,
  };
}

// Mean of the delays, in days, rounded to one decimal; null when none.
function averageDays(delaysMs: number[]): number | null {
  if (delaysMs.length === 0) return null;
  const mean = delaysMs.reduce((sum, d) => sum + d, 0) / delaysMs.length;
  return Math.round((mean / DAY_MS) * 10) / 10;
}

// "À faire" = assigned to me and still actionable on my side. A task that
// is EN_ATTENTE_VALIDATION is waiting on someone else, so it's excluded.
const TODO_STATUSES: InstructionStatus[] = [
  InstructionStatus.AFFECTEE,
  InstructionStatus.ACCEPTEE,
  InstructionStatus.EN_COURS,
  InstructionStatus.A_CORRIGER,
];

@Injectable()
export class DashboardService {
  constructor(
    private readonly database: DatabaseService,
    private readonly rbac: RbacService,
  ) {}

  /**
   * Everything the dashboard shows, scoped to the caller. Each section the
   * caller isn't entitled to is `null` (not zero) so the UI can hide it
   * rather than show a misleading 0:
   * - tasks: always — they're the caller's own instructions;
   * - approvals: always — the courriers waiting on the caller's
   *   validation (GET /courriers/awaiting-my-validation);
   * - courriers / trend: only with COURRIER_READ, and only courriers in
   *   dossiers the caller can see.
   */
  async getStats(userId: string, query: DashboardStatsQueryDto) {
    const days = query.days ?? 7;
    const timeZone = query.tz ?? 'UTC';
    const global = query.scope === 'global';
    // Held globally: every site. Held at a site, or as its responsible: that
    // site only.
    const sites = global
      ? await this.rbac.managedSites(userId, PermissionCode.DashboardGlobalRead)
      : null;
    if (sites?.length === 0) {
      throw new ForbiddenException(
        'The global dashboard requires DASHBOARD_GLOBAL_READ',
      );
    }
    const permissions = global
      ? []
      : await this.rbac.getPermissionCodes(userId);
    const canReadCourriers =
      global || permissions.includes(PermissionCode.CourrierRead);
    const incoming = canReadCourriers
      ? await this.incomingScope(userId, sites)
      : null;

    const [tasks, approvals, courriers, trend, activity] = await Promise.all([
      this.getTasks(userId),
      this.getApprovals(userId),
      incoming ? this.getCourriers(incoming) : null,
      incoming ? this.getTrend(incoming, days, timeZone) : null,
      incoming ? this.getIncomingActivity(incoming, timeZone) : null,
    ]);

    return {
      scope: global ? 'global' : 'mine',
      tasks,
      approvals,
      courriers,
      trend,
      // Dispatching, effets in progress and treatment delay, compared with
      // the previous week / month (weeks start on Monday, in `tz`).
      incoming: activity,
    };
  }

  // The entrants counted: every one or those of some sites (global, `sites`
  // given), else those in the dossiers the caller sees. An entrant without a
  // dossier yet is on its registrant's site.
  private async incomingScope(
    userId: string,
    sites: SiteScopeList | null,
  ): Promise<Prisma.CourrierWhereInput> {
    const direction = CourrierDirection.ENTRANT;
    if (sites === 'ALL') return { direction };
    if (sites) {
      return {
        direction,
        OR: [
          { dossier: { siteId: { in: sites } } },
          { dossierId: null, createdBy: { siteId: { in: sites } } },
        ],
      };
    }
    return { direction, dossier: await this.courrierDossiers(userId) };
  }

  private async getIncomingActivity(
    incoming: Prisma.CourrierWhereInput,
    timeZone: string,
  ) {
    const now = new Date();
    const today = localToday(now.getTime(), timeZone);
    const weekStart = zonedMidnight(
      today.year,
      today.month,
      today.day - today.weekday,
      timeZone,
    );
    const lastWeekStart = zonedMidnight(
      today.year,
      today.month,
      today.day - today.weekday - 7,
      timeZone,
    );
    const monthStart = zonedMidnight(today.year, today.month, 1, timeZone);
    const lastMonthStart = zonedMidnight(
      today.year,
      today.month - 1,
      1,
      timeZone,
    );

    // Received before `at` and not yet closed, archived or cancelled then.
    const inProgressAt = (at: Date): Prisma.CourrierWhereInput => ({
      AND: [
        incoming,
        {
          OR: [
            { receivedAt: { lt: at } },
            { receivedAt: null, createdAt: { lt: at } },
          ],
        },
        { OR: [{ closedAt: null }, { closedAt: { gte: at } }] },
        { OR: [{ archivedAt: null }, { archivedAt: { gte: at } }] },
        { OR: [{ cancelledAt: null }, { cancelledAt: { gte: at } }] },
      ],
    });

    const [
      dispatchedThisWeek,
      dispatchedLastWeek,
      inProgressNow,
      inProgressLastWeek,
      closed,
    ] = await Promise.all([
      this.database.courrier.count({
        where: {
          ...incoming,
          dispatchValidatedAt: { gte: weekStart, lt: now },
        },
      }),
      this.database.courrier.count({
        where: {
          ...incoming,
          dispatchValidatedAt: { gte: lastWeekStart, lt: weekStart },
        },
      }),
      this.database.courrier.count({
        where: { ...incoming, status: { notIn: INCOMING_DONE } },
      }),
      this.database.courrier.count({ where: inProgressAt(weekStart) }),
      this.database.courrier.findMany({
        where: { ...incoming, closedAt: { gte: lastMonthStart, lt: now } },
        select: { receivedAt: true, createdAt: true, closedAt: true },
      }),
    ]);

    const delays = (from: Date, to: Date) =>
      closed
        .filter((row) => row.closedAt! >= from && row.closedAt! < to)
        .map(
          (row) =>
            row.closedAt!.getTime() -
            (row.receivedAt ?? row.createdAt).getTime(),
        );

    return {
      timeZone,
      weekStart,
      dispatched: {
        thisWeek: dispatchedThisWeek,
        lastWeek: dispatchedLastWeek,
      },
      inProgress: { current: inProgressNow, lastWeek: inProgressLastWeek },
      // From reception to closure, of the entrants closed in the month.
      treatmentDelayDays: {
        thisMonth: averageDays(delays(monthStart, now)),
        lastMonth: averageDays(delays(lastMonthStart, monthStart)),
      },
    };
  }

  private async getTasks(userId: string) {
    const mine: Prisma.InstructionWhereInput = {
      assignees: { some: { userId } },
    };
    const [todo, completed, overdue] = await this.database.$transaction([
      this.database.instruction.count({
        where: { ...mine, status: { in: TODO_STATUSES } },
      }),
      this.database.instruction.count({
        where: { ...mine, status: InstructionStatus.TERMINEE },
      }),
      this.database.instruction.count({
        where: { ...mine, ...overdueWhere(new Date()) },
      }),
    ]);
    return { todo, completed, overdue };
  }

  private async getApprovals(userId: string) {
    const awaitingMyDecision = await this.database.courrier.count({
      where: awaitingValidationBy(userId),
    });
    return { awaitingMyDecision };
  }

  // Dossiers the caller sees, on the sites where they may read courriers.
  private async courrierDossiers(
    userId: string,
  ): Promise<Prisma.DossierWhereInput> {
    const sites = await this.rbac.siteFilter(
      userId,
      PermissionCode.CourrierRead,
      (siteId): Prisma.DossierWhereInput => ({ siteId }),
    );
    return { AND: [visibleDossierWhere(userId), sites] };
  }

  private async getCourriers(incoming: Prisma.CourrierWhereInput) {
    const [received, archived] = await this.database.$transaction([
      this.database.courrier.count({ where: incoming }),
      this.database.courrier.count({
        where: { ...incoming, status: CourrierStatus.ARCHIVE },
      }),
    ]);
    return { received, archived };
  }

  /**
   * Incoming courriers per day over the last `days` days (today included),
   * oldest first, with empty days present as 0. A courrier counts on its
   * `receivedAt` date, falling back to `createdAt` when that wasn't
   * recorded. Days are cut in `timeZone`.
   */
  private async getTrend(
    incoming: Prisma.CourrierWhereInput,
    days: TrendPeriod,
    timeZone: string,
  ) {
    const dayKey = new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    });
    const now = Date.now();
    const counts = new Map<string, number>();
    for (let i = days - 1; i >= 0; i--) {
      counts.set(dayKey.format(now - i * DAY_MS), 0);
    }

    // One extra day of margin: the oldest bucket starts at local midnight,
    // which can be up to a day before `now - days`. Rows outside the
    // buckets are dropped below.
    const since = new Date(now - (days + 1) * DAY_MS);
    const rows = await this.database.courrier.findMany({
      where: {
        AND: [
          incoming,
          {
            OR: [
              { receivedAt: { gte: since } },
              { receivedAt: null, createdAt: { gte: since } },
            ],
          },
        ],
      },
      select: { receivedAt: true, createdAt: true },
    });

    for (const row of rows) {
      const key = dayKey.format(row.receivedAt ?? row.createdAt);
      const current = counts.get(key);
      if (current !== undefined) counts.set(key, current + 1);
    }

    return {
      days,
      timeZone,
      points: [...counts].map(([date, count]) => ({ date, count })),
    };
  }
}
