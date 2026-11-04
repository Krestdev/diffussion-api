import {
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ClsService } from 'nestjs-cls';
import { Prisma } from '../../generated/prisma/client';
import { DatabaseService } from '../database/database.service';
import { AppClsStore } from '../cls.store';
import { FindActivityLogsQueryDto } from './dto/find-activity-logs.query.dto';
import { FindMyActivityQueryDto } from './dto/find-my-activity.query.dto';

export interface ActivityPayload {
  action: string;
  source?: 'USER' | 'SYSTEM';
  level?: 'info' | 'warn' | 'error';
  entityType?: string;
  entityId?: string;
  message?: string;
  stack?: string;
  changes?: Record<string, [unknown, unknown]>;
  metadata?: Record<string, unknown>;
}

// Column limits from schema.prisma — a value longer than its column used to
// fail the whole request the log was describing.
const MAX_ACTION = 255;
const MAX_ACTOR_LABEL = 100;
const MAX_ENTITY_TYPE = 50;

// What the audit journal shows: actions performed by a user.
const USER_ACTIONS: Prisma.ActivityLogWhereInput = { userId: { not: null } };

function truncate(value: string, max: number): string;
function truncate(value: string | null, max: number): string | null;
function truncate(value: string | null, max: number): string | null {
  if (value === null) return null;
  return value.length <= max ? value : `${value.slice(0, max - 1)}…`;
}

@Injectable()
export class ActivityService {
  private readonly logger = new Logger(ActivityService.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly cls: ClsService<AppClsStore>,
  ) {}

  /**
   * Create an activity log entry. If this is the first log for the current
   * request (no parentLogId in CLS yet) it is automatically promoted to
   * **root** and its ID is stored in CLS so all subsequent calls become its
   * children. This way the first real business event (e.g. "Courrier validated")
   * becomes the root visible in the audit-log UI rather than a generic
   * "POST /api/..." interceptor entry.
   */
  async record(payload: ActivityPayload): Promise<string> {
    const meta: Record<string, unknown> = {};
    if (payload.changes) meta.changes = payload.changes;
    if (payload.metadata) Object.assign(meta, payload.metadata);

    const userId = this.cls.get('userId') ?? null;
    const log = await this.db.activityLog.create({
      data: {
        parentLogId: this.cls.get('parentLogId') ?? null,
        userId,
        actorLabel: truncate(
          this.cls.get('actorLabel') ?? null,
          MAX_ACTOR_LABEL,
        ),
        // Whatever happens inside an authenticated request is that user's
        // action; SYSTEM is left to work no user triggered.
        source: payload.source ?? (userId ? 'USER' : 'SYSTEM'),
        level: payload.level ?? 'info',
        action: truncate(payload.action, MAX_ACTION),
        entityType: truncate(payload.entityType ?? null, MAX_ENTITY_TYPE),
        entityId: payload.entityId ?? null,
        message: payload.message ?? null,
        stack: payload.stack ?? null,
        metadata: Object.keys(meta).length
          ? (meta as Prisma.InputJsonValue)
          : undefined,
      },
    });

    // Auto-promote: first log written in this request becomes the root so
    // all subsequent record() calls land as its children.
    if (!this.cls.get('parentLogId')) {
      this.cls.set('parentLogId', log.id);
    }

    return log.id;
  }

  /**
   * Explicitly create a root log and store its ID in CLS.
   * Kept for backwards-compat with callers that need an explicit root;
   * record() now auto-promotes if no root has been set yet.
   */
  async recordRoot(payload: ActivityPayload): Promise<string> {
    // Clear any existing parentLogId so this entry writes as root.
    this.cls.set('parentLogId', undefined as unknown as string);
    return this.record(payload);
  }

  /**
   * record() for callers that must not fail the business action they are
   * describing — the interceptor (whose write happens before the handler
   * runs) and @AuditLog (whose write happens after the change is already
   * committed, so a 500 here would wrongly suggest nothing happened).
   * Returns null when the entry could not be written.
   */
  async tryRecord(
    payload: ActivityPayload,
    { asRoot = false }: { asRoot?: boolean } = {},
  ): Promise<string | null> {
    try {
      return asRoot
        ? await this.recordRoot(payload)
        : await this.record(payload);
    } catch (error) {
      this.logger.error(
        `Failed to write activity log "${payload.action}"`,
        error instanceof Error ? error.stack : String(error),
      );
      return null;
    }
  }

  /**
   * Paginated, filterable listing for the Journal d'audit admin screen.
   * Root logs only (parentLogId: null) — the request-scoped child/grandchild
   * entries recorded by ActivityInterceptor/activity.record() are traceable
   * detail, not separate rows in the top-level audit list.
   */
  /**
   * User actions only — system entries (errors, warnings, work no user
   * triggered) are never returned. `siteIds`: a site administrator only
   * sees what their site's users did ('ALL' for a platform administrator).
   */
  async findAll(query: FindActivityLogsQueryDto, siteIds: 'ALL' | string[]) {
    const where: Prisma.ActivityLogWhereInput = {
      AND: [USER_ACTIONS, await this.actorsOf(siteIds)],
      parentLogId: null,
      level: query.level,
      entityType: query.entityType,
      entityId: query.entityId,
      userId: query.userId,
      OR: query.search
        ? [
            { action: { contains: query.search, mode: 'insensitive' } },
            { message: { contains: query.search, mode: 'insensitive' } },
          ]
        : undefined,
    };

    const [data, total] = await this.db.$transaction([
      this.db.activityLog.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: query.skip ?? 0,
        take: query.take ?? 20,
      }),
      this.db.activityLog.count({ where }),
    ]);

    return {
      data: await this.withNames(data),
      total,
      skip: query.skip ?? 0,
      take: query.take ?? 20,
    };
  }

  /**
   * A user's own history: the business events (on an object, by a user)
   * that they did, or that were done on their objects —
   *   - effets they registered, are in charge of, or supervise;
   *   - instructions they are on (any role) or created;
   *   - fiches d'analyse they wrote or validate.
   * Most recent first, with actorName and entityReference.
   */
  async findMine(query: FindMyActivityQueryDto, userId: string) {
    const skip = query.skip ?? 0;
    const take = query.take ?? 20;
    const [courriers, instructions, sheets] = await Promise.all([
      this.db.courrier.findMany({
        where: {
          OR: [
            { createdById: userId },
            { ownerId: userId },
            { supervisorId: userId },
          ],
        },
        select: { id: true },
      }),
      this.db.instruction.findMany({
        where: {
          OR: [{ createdById: userId }, { assignees: { some: { userId } } }],
        },
        select: { id: true },
      }),
      this.db.analysisSheet.findMany({
        where: { OR: [{ authorId: userId }, { validatorId: userId }] },
        select: { id: true },
      }),
    ]);
    const onMine = (entityType: string, rows: { id: string }[]) =>
      rows.length
        ? [{ entityType, entityId: { in: rows.map((row) => row.id) } }]
        : [];

    const where: Prisma.ActivityLogWhereInput = {
      ...USER_ACTIONS,
      parentLogId: null,
      entityType: query.entityType ?? { not: null },
      OR: [
        { userId },
        ...onMine('Courrier', courriers),
        ...onMine('Instruction', instructions),
        ...onMine('analysis-sheet', sheets),
      ],
    };
    const [data, total] = await this.db.$transaction([
      this.db.activityLog.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take,
        select: {
          id: true,
          createdAt: true,
          userId: true,
          actorLabel: true,
          action: true,
          entityType: true,
          entityId: true,
          message: true,
          metadata: true,
        },
      }),
      this.db.activityLog.count({ where }),
    ]);
    return { data: await this.withNames(data), total, skip, take };
  }

  async findOne(id: string, siteIds: 'ALL' | string[]) {
    const log = await this.db.activityLog.findFirst({
      where: { id, AND: [USER_ACTIONS, await this.actorsOf(siteIds)] },
      include: {
        children: { where: USER_ACTIONS, orderBy: { createdAt: 'asc' } },
      },
    });
    if (!log) {
      const exists = await this.db.activityLog.count({
        where: { id, ...USER_ACTIONS },
      });
      if (exists) throw new ForbiddenException('This belongs to another site');
      throw new NotFoundException(`Activity log ${id} not found`);
    }
    const [named, ...children] = await this.withNames([log, ...log.children]);
    return { ...named, children };
  }

  /**
   * Adds to each entry who did it (`actorName`: the user's name, else the
   * recorded label) and the human reference of what it was done on
   * (`entityReference`: M-…, T-…, D-…, CT-…, FA-…), one query per kind of
   * object for the whole page. Null when unknown or deleted since.
   */
  async withNames<
    T extends {
      userId: string | null;
      actorLabel: string | null;
      entityType: string | null;
      entityId: string | null;
    },
  >(logs: T[]) {
    const userIds = [
      ...new Set(logs.map((log) => log.userId).filter((id) => id !== null)),
    ];
    const byType = new Map<string, Set<string>>();
    for (const log of logs) {
      if (!log.entityType || !log.entityId) continue;
      const ids = byType.get(log.entityType) ?? new Set<string>();
      ids.add(log.entityId);
      byType.set(log.entityType, ids);
    }

    const [users, references] = await Promise.all([
      userIds.length
        ? this.db.user.findMany({
            where: { id: { in: userIds } },
            select: { id: true, name: true },
          })
        : Promise.resolve([] as { id: string; name: string }[]),
      Promise.all(
        [...byType].map(
          async ([type, ids]): Promise<[string, Map<string, string>]> => [
            type,
            await this.referencesOf(type, [...ids]),
          ],
        ),
      ),
    ]);
    const names = new Map(users.map((user) => [user.id, user.name]));
    const refs = new Map(references);

    return logs.map((log) => ({
      ...log,
      actorName: (log.userId && names.get(log.userId)) ?? log.actorLabel,
      entityReference:
        (log.entityType &&
          log.entityId &&
          refs.get(log.entityType)?.get(log.entityId)) ??
        null,
    }));
  }

  // id -> human reference, for the kinds of objects that have one.
  private async referencesOf(
    type: string,
    ids: string[],
  ): Promise<Map<string, string>> {
    const where = { id: { in: ids } };
    const pairs = (rows: { id: string; ref: string | null }[]) =>
      new Map(
        rows
          .filter((row): row is { id: string; ref: string } => !!row.ref)
          .map((row) => [row.id, row.ref]),
      );
    switch (type.toLowerCase()) {
      case 'courrier':
        return pairs(
          (
            await this.db.courrier.findMany({
              where,
              select: { id: true, number: true },
            })
          ).map((row) => ({ id: row.id, ref: row.number })),
        );
      case 'instruction':
        return pairs(
          (
            await this.db.instruction.findMany({
              where,
              select: { id: true, number: true },
            })
          ).map((row) => ({ id: row.id, ref: row.number })),
        );
      case 'dossier':
        return pairs(
          (
            await this.db.dossier.findMany({
              where,
              select: { id: true, number: true },
            })
          ).map((row) => ({ id: row.id, ref: row.number })),
        );
      case 'contract':
        return pairs(
          (
            await this.db.contract.findMany({
              where,
              select: { id: true, number: true },
            })
          ).map((row) => ({ id: row.id, ref: row.number })),
        );
      case 'project':
        return pairs(
          (
            await this.db.project.findMany({
              where,
              select: { id: true, reference: true, name: true },
            })
          ).map((row) => ({ id: row.id, ref: row.reference ?? row.name })),
        );
      case 'analysis-sheet':
        return pairs(
          (
            await this.db.analysisSheet.findMany({
              where,
              select: { id: true, reference: true },
            })
          ).map((row) => ({ id: row.id, ref: row.reference })),
        );
      case 'site':
        return pairs(
          (
            await this.db.site.findMany({
              where,
              select: { id: true, code: true },
            })
          ).map((row) => ({ id: row.id, ref: row.code })),
        );
      default:
        return new Map();
    }
  }

  private async actorsOf(
    siteIds: 'ALL' | string[],
  ): Promise<Prisma.ActivityLogWhereInput> {
    if (siteIds === 'ALL') return {};
    const users = await this.db.user.findMany({
      where: { siteId: { in: siteIds } },
      select: { id: true },
    });
    return { userId: { in: users.map((user) => user.id) } };
  }
}
