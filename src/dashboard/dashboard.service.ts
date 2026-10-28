import { Injectable } from '@nestjs/common';
import {
  CourrierDirection,
  CourrierStatus,
  InstructionStatus,
  Prisma,
} from '../../generated/prisma/client';
import { PermissionCode } from '../auth/rbac/rbac.constants';
import { RbacService } from '../auth/rbac/rbac.service';
import { awaitingValidationBy } from '../common/utils/courrier-validation';
import { overdueWhere } from '../instructions/instruction-overdue';
import { visibleDossierWhere } from '../common/utils/dossier-visibility';
import { DatabaseService } from '../database/database.service';
import {
  DashboardStatsQueryDto,
  TrendPeriod,
} from './dto/dashboard-stats.query.dto';

const DAY_MS = 24 * 60 * 60 * 1000;

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
    const permissions = await this.rbac.getPermissionCodes(userId);
    const canReadCourriers = permissions.includes(PermissionCode.CourrierRead);

    const [tasks, approvals, courriers, trend] = await Promise.all([
      this.getTasks(userId),
      this.getApprovals(userId),
      canReadCourriers ? this.getCourriers(userId) : null,
      canReadCourriers ? this.getTrend(userId, days, timeZone) : null,
    ]);

    return { tasks, approvals, courriers, trend };
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

  private async getCourriers(userId: string) {
    const incoming: Prisma.CourrierWhereInput = {
      direction: CourrierDirection.ENTRANT,
      dossier: await this.courrierDossiers(userId),
    };
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
  private async getTrend(userId: string, days: TrendPeriod, timeZone: string) {
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
        direction: CourrierDirection.ENTRANT,
        dossier: await this.courrierDossiers(userId),
        OR: [
          { receivedAt: { gte: since } },
          { receivedAt: null, createdAt: { gte: since } },
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
