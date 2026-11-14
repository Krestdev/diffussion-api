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
import { AccessService } from '../auth/access/access.service';
import { StorageService } from '../storage/storage.service';
import { categoriesWhere, categoryOf } from './audit-categories';
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
  /** The entry's company, when the caller knows it better than its object. */
  companyId?: string | null;
}

// Column limits from schema.prisma — a value longer than its column used to
// fail the whole request the log was describing.
const MAX_ACTION = 255;
const MAX_ACTOR_LABEL = 100;
const MAX_ENTITY_TYPE = 50;

// What the audit journal shows: actions performed by a user, and the
// system's own business events on an object (an automatic archiving) —
// never its technical warnings and errors.
const USER_ACTIONS: Prisma.ActivityLogWhereInput = {
  OR: [
    { userId: { not: null } },
    { source: 'SYSTEM', level: 'info', entityType: { not: null } },
  ],
};

// The most rows an export returns.
const MAX_EXPORT = 10_000;

// Objects common to every company: their entries have no company (platform audit
// only) — never their author's.
const PLATFORM_OBJECTS = new Set([
  'role',
  'permission',
  'category',
  'courrier-nature',
  'correspondent-type',
  'settings',
]);

function truncate(value: string, max: number): string;
function truncate(value: string | null, max: number): string | null;
function truncate(value: string | null, max: number): string | null {
  if (value === null) return null;
  return value.length <= max ? value : `${value.slice(0, max - 1)}…`;
}

type LogRow = {
  userId: string | null;
  actorLabel: string | null;
  action: string;
  entityType: string | null;
  entityId: string | null;
  companyId?: string | null;
};

type Reference = { ref: string | null; context: string | null };

@Injectable()
export class ActivityService {
  private readonly logger = new Logger(ActivityService.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly cls: ClsService<AppClsStore>,
    private readonly access: AccessService,
    private readonly storage: StorageService,
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
    const companyId =
      payload.companyId !== undefined
        ? payload.companyId
        : await this.companyOf(payload.entityType, payload.entityId, userId);
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
        companyId,
        ip: this.cls.get('ip') ?? null,
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
   * The Journal d'audit (AU·1): root entries of user actions only — the
   * request-scoped children are traceable detail, and system entries
   * (errors, work no user triggered) are never returned. `companyIds`: the
   * companies the caller may audit (their own, with audit.read): an
   * entry belongs to its object's company, else its author's.
   */
  async findAll(query: FindActivityLogsQueryDto, companyIds: string[]) {
    const where = await this.journalWhere(query, companyIds);
    const skip = query.skip ?? 0;
    const take = query.take ?? 20;
    const [data, total] = await this.db.$transaction([
      this.db.activityLog.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take,
      }),
      this.db.activityLog.count({ where }),
    ]);
    return { data: await this.withNames(data), total, skip, take };
  }

  /** The same entries as findAll, every page, as CSV (`;`-separated). */
  async exportCsv(query: FindActivityLogsQueryDto, companyIds: string[]) {
    const rows = await this.db.activityLog.findMany({
      where: await this.journalWhere(query, companyIds),
      orderBy: { createdAt: 'desc' },
      take: MAX_EXPORT,
    });
    const named = await this.withNames(rows);
    const header = [
      'Date',
      'Auteur',
      'Action',
      'Catégorie',
      'Objet',
      'Référence',
      'Contexte',
      'Company',
      'IP',
      'Message',
    ];
    const lines = named.map((log) =>
      [
        log.createdAt.toISOString(),
        log.actorName,
        log.action,
        log.category,
        log.entityType,
        log.entityReference,
        log.contextReference,
        log.company?.name,
        log.ip,
        log.message,
      ]
        .map(csvCell)
        .join(';'),
    );
    // BOM: Excel reads the accents right.
    return '﻿' + [header.join(';'), ...lines].join('\r\n');
  }

  /** The exported batches (PA·8) of the companies the caller may audit. */
  async archives(companyIds: string[], companyId?: string) {
    return this.db.auditArchive.findMany({
      where: {
        AND: [
          { companyId: { in: companyIds } },
          companyId ? { companyId } : {},
        ],
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  /** One exported batch's CSV file. */
  async archiveFile(id: string, companyIds: string[]) {
    const archive = await this.db.auditArchive.findUnique({ where: { id } });
    if (!archive) throw new NotFoundException(`Archive ${id} not found`);
    if (!(archive.companyId && companyIds.includes(archive.companyId))) {
      throw new ForbiddenException('This belongs to another company');
    }
    const file = await this.storage.download(archive.storageKey);
    const day = (date: Date) => date.toISOString().slice(0, 10);
    return {
      body: file.body,
      filename: `journal-audit-${day(archive.fromDate)}-${day(archive.toDate)}.csv`,
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
      // Kept in AND: it is an OR itself, which the one below must not replace.
      AND: [USER_ACTIONS],
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
          companyId: true,
        },
      }),
      this.db.activityLog.count({ where }),
    ]);
    return { data: await this.withNames(data), total, skip, take };
  }

  async findOne(id: string, companyIds: string[]) {
    const log = await this.db.activityLog.findFirst({
      where: { id, AND: [USER_ACTIONS, companiesWhere(companyIds)] },
      include: {
        children: { where: USER_ACTIONS, orderBy: { createdAt: 'asc' } },
      },
    });
    if (!log) {
      const exists = await this.db.activityLog.count({
        where: { id, ...USER_ACTIONS },
      });
      if (exists)
        throw new ForbiddenException('This belongs to another company');
      throw new NotFoundException(`Activity log ${id} not found`);
    }
    const [named, ...children] = await this.withNames([log, ...log.children]);
    return { ...named, children };
  }

  /**
   * Adds to each entry who did it (`actorName`: the user's name, else the
   * recorded label), the human reference of what it was done on
   * (`entityReference`: M-…, T-…, D-…, CT-…, FA-…), its context
   * (`contextReference`: the contract — its own reference, else its number —
   * or the dossier of the effet / instruction / fiche), its `category` and
   * its `company`. One query per kind of object for the whole page. Null when
   * unknown or deleted since.
   */
  async withNames<T extends LogRow>(logs: T[]) {
    const userIds = [
      ...new Set(logs.map((log) => log.userId).filter((id) => id !== null)),
    ];
    const companyIds = [
      ...new Set(
        logs
          .map((log) => log.companyId)
          .filter((id): id is string => typeof id === 'string'),
      ),
    ];
    const byType = new Map<string, Set<string>>();
    for (const log of logs) {
      if (!log.entityType || !log.entityId) continue;
      const ids = byType.get(log.entityType) ?? new Set<string>();
      ids.add(log.entityId);
      byType.set(log.entityType, ids);
    }

    const [users, companies, references] = await Promise.all([
      userIds.length
        ? this.db.user.findMany({
            where: { id: { in: userIds } },
            select: { id: true, name: true },
          })
        : Promise.resolve([] as { id: string; name: string }[]),
      companyIds.length
        ? this.db.company.findMany({
            where: { id: { in: companyIds } },
            select: { id: true, code: true, name: true },
          })
        : Promise.resolve([] as { id: string; code: string; name: string }[]),
      Promise.all(
        [...byType].map(
          async ([type, ids]): Promise<[string, Map<string, Reference>]> => [
            type,
            await this.referencesOf(type, [...ids]),
          ],
        ),
      ),
    ]);
    const names = new Map(users.map((user) => [user.id, user.name]));
    const companyById = new Map(
      companies.map((company) => [company.id, company]),
    );
    const refs = new Map(references);

    return logs.map((log) => {
      const reference =
        (log.entityType &&
          log.entityId &&
          refs.get(log.entityType)?.get(log.entityId)) ||
        null;
      return {
        ...log,
        actorName: (log.userId && names.get(log.userId)) ?? log.actorLabel,
        entityReference: reference?.ref ?? null,
        contextReference: reference?.context ?? null,
        category: categoryOf(log),
        company: (log.companyId && companyById.get(log.companyId)) || null,
      };
    });
  }

  // ----------------------------------------------------------------- where

  private async journalWhere(
    query: FindActivityLogsQueryDto,
    companyIds: string[],
  ): Promise<Prisma.ActivityLogWhereInput> {
    const to = query.to ? endOf(query.to) : undefined;
    // A correspondent's history includes its effets' events.
    const correspondentId =
      query.correspondentId ??
      (query.entityType === 'correspondent' ? query.entityId : undefined);
    const effets = correspondentId
      ? await this.db.courrier.findMany({
          where: { correspondentId },
          select: { id: true },
        })
      : [];
    return {
      AND: [
        USER_ACTIONS,
        companiesWhere(companyIds),
        correspondentId
          ? {
              OR: [
                { entityType: 'correspondent', entityId: correspondentId },
                {
                  entityType: 'Courrier',
                  entityId: { in: effets.map((effet) => effet.id) },
                },
              ],
            }
          : {},
        query.companyId ? { companyId: query.companyId } : {},
        query.category?.length ? categoriesWhere(query.category) : {},
        query.action?.length ? { action: { in: query.action } } : {},
        query.search
          ? {
              OR: [
                { action: { contains: query.search, mode: 'insensitive' } },
                { message: { contains: query.search, mode: 'insensitive' } },
              ],
            }
          : {},
      ],
      parentLogId: null,
      level: query.level,
      entityType: correspondentId ? undefined : query.entityType,
      entityId: correspondentId ? undefined : query.entityId,
      userId: query.userId,
      createdAt:
        query.from || to
          ? {
              ...(query.from ? { gte: new Date(query.from) } : {}),
              ...(to ? { lt: to } : {}),
            }
          : undefined,
    };
  }

  // ------------------------------------------------------------------- company

  /**
   * The company an entry belongs to: its object's — an effet's, an
   * instruction's, a dossier's, a project's... — else, for an object that
   * isn't common to every company, its author's.
   */
  private async companyOf(
    entityType: string | undefined,
    entityId: string | undefined,
    userId: string | null,
  ): Promise<string | null> {
    const type = entityType?.toLowerCase();
    if (type && entityId) {
      const found = await this.objectCompany(type, entityId).catch(
        () => undefined,
      );
      if (found) return found;
      // A common object (a global role, a common referential...): platform
      // audit only, never its author's company.
      if (found === null || PLATFORM_OBJECTS.has(type)) return null;
    }
    if (!userId) return null;
    const author = await this.db.user.findUnique({
      where: { id: userId },
      select: { companyId: true },
    });
    return author?.companyId ?? null;
  }

  // undefined: unknown kind or object; null: an object of no company.
  private async objectCompany(
    type: string,
    id: string,
  ): Promise<string | null | undefined> {
    switch (type) {
      case 'courrier':
        return this.access.resolveCompanyId('courrier', id);
      case 'instruction':
        return this.access.resolveCompanyId('instruction', id);
      case 'livrable':
        return this.access.resolveCompanyId('livrable', id);
      case 'dossier':
        return this.access.resolveCompanyId('dossier', id);
      case 'analysis-sheet':
        return this.access.resolveCompanyId('analysisSheet', id);
      case 'company':
        return this.access.resolveCompanyId('company', id);
      case 'project':
        return (
          await this.db.project.findUnique({
            where: { id },
            select: { companyId: true },
          })
        )?.companyId;
      case 'contract': {
        const contract = await this.db.contract.findUnique({
          where: { id },
          select: { project: { select: { companyId: true } } },
        });
        return contract ? (contract.project?.companyId ?? null) : undefined;
      }
      case 'canal':
        return (
          await this.db.canal.findUnique({
            where: { id },
            select: { companyId: true },
          })
        )?.companyId;
      case 'correspondent':
        return (
          await this.db.correspondent.findUnique({
            where: { id },
            select: { companyId: true },
          })
        )?.companyId;
      case 'analysis-criterion-template': {
        const row = await this.db.analysisCriterionTemplate.findUnique({
          where: { id },
          select: { companyId: true },
        });
        return row ? row.companyId : undefined;
      }
      case 'effet-type': {
        const row = await this.db.effetType.findUnique({
          where: { id },
          select: { companyId: true },
        });
        return row ? row.companyId : undefined;
      }
      case 'role': {
        const row = await this.db.role.findUnique({
          where: { id },
          select: { companyId: true },
        });
        return row ? row.companyId : undefined;
      }
      case 'user': {
        const row = await this.db.user.findUnique({
          where: { id },
          select: { companyId: true },
        });
        return row ? row.companyId : undefined;
      }
      case 'delegation':
        return (
          await this.db.delegation.findUnique({
            where: { id },
            select: { companyId: true },
          })
        )?.companyId;
      default:
        return undefined;
    }
  }

  // ------------------------------------------------------------ references

  // id -> human reference (and context), for the kinds of objects that have one.
  private async referencesOf(
    type: string,
    ids: string[],
  ): Promise<Map<string, Reference>> {
    const where = { id: { in: ids } };
    const contractRef = (
      contract: { reference: string | null; number: string } | null,
    ) => (contract ? (contract.reference ?? contract.number) : null);
    const contextSelect = {
      dossier: { select: { number: true } },
      contract: { select: { reference: true, number: true } },
    } as const;
    const map = (
      rows: { id: string; ref: string | null; context?: string | null }[],
    ) =>
      new Map(
        rows.map((row) => [
          row.id,
          { ref: row.ref, context: row.context ?? null },
        ]),
      );

    switch (type.toLowerCase()) {
      case 'courrier':
        return map(
          (
            await this.db.courrier.findMany({
              where,
              select: { id: true, number: true, ...contextSelect },
            })
          ).map((row) => ({
            id: row.id,
            ref: row.number,
            context: contractRef(row.contract) ?? row.dossier?.number ?? null,
          })),
        );
      case 'instruction':
        return map(
          (
            await this.db.instruction.findMany({
              where,
              select: {
                id: true,
                number: true,
                ...contextSelect,
                courrier: { select: contextSelect },
              },
            })
          ).map((row) => ({
            id: row.id,
            ref: row.number,
            context:
              contractRef(row.contract) ??
              row.dossier?.number ??
              contractRef(row.courrier?.contract ?? null) ??
              row.courrier?.dossier?.number ??
              null,
          })),
        );
      case 'dossier':
        return map(
          (
            await this.db.dossier.findMany({
              where,
              select: {
                id: true,
                number: true,
                contract: { select: { reference: true, number: true } },
              },
            })
          ).map((row) => ({
            id: row.id,
            ref: row.number,
            context: contractRef(row.contract),
          })),
        );
      case 'contract':
        return map(
          (
            await this.db.contract.findMany({
              where,
              select: { id: true, number: true, reference: true },
            })
          ).map((row) => ({
            id: row.id,
            ref: row.number,
            context: row.reference,
          })),
        );
      case 'project':
        return map(
          (
            await this.db.project.findMany({
              where,
              select: { id: true, reference: true, name: true },
            })
          ).map((row) => ({ id: row.id, ref: row.reference ?? row.name })),
        );
      case 'analysis-sheet':
        return map(
          (
            await this.db.analysisSheet.findMany({
              where,
              select: { id: true, reference: true, ...contextSelect },
            })
          ).map((row) => ({
            id: row.id,
            ref: row.reference,
            context: contractRef(row.contract) ?? row.dossier?.number ?? null,
          })),
        );
      case 'company':
        return map(
          (
            await this.db.company.findMany({
              where,
              select: { id: true, code: true },
            })
          ).map((row) => ({ id: row.id, ref: row.code })),
        );
      case 'role':
        return map(
          (
            await this.db.role.findMany({
              where,
              select: { id: true, name: true },
            })
          ).map((row) => ({ id: row.id, ref: row.name })),
        );
      case 'user':
        return map(
          (
            await this.db.user.findMany({
              where,
              select: { id: true, email: true },
            })
          ).map((row) => ({ id: row.id, ref: row.email })),
        );
      default:
        return new Map();
    }
  }
}

// The companies a caller may audit: every one, or theirs.
function companiesWhere(companyIds: string[]): Prisma.ActivityLogWhereInput {
  return { companyId: { in: companyIds } };
}

// `to` as an exclusive bound: a bare date covers its whole day.
function endOf(to: string): Date {
  const date = new Date(to);
  if (/^\d{4}-\d{2}-\d{2}$/.test(to)) {
    date.setUTCDate(date.getUTCDate() + 1);
  }
  return date;
}

function csvCell(value: unknown): string {
  if (value === null || value === undefined) return '';
  const text =
    typeof value === 'string'
      ? value
      : typeof value === 'number' || typeof value === 'boolean'
        ? String(value)
        : JSON.stringify(value);
  return /[";\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}
