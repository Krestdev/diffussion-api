import { Injectable } from '@nestjs/common';
import { ClsService } from 'nestjs-cls';
import { Prisma } from '../../generated/prisma/client';
import { DatabaseService } from '../database/database.service';
import { AppClsStore } from '../cls.store';

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

@Injectable()
export class ActivityService {
  constructor(
    private readonly db: DatabaseService,
    private readonly cls: ClsService<AppClsStore>,
  ) {}

  /**
   * Create an activity log entry linked to the current request's parentLogId.
   * Returns the created log's ID so callers can use it for further chaining.
   */
  async record(payload: ActivityPayload): Promise<string> {
    const meta: Record<string, unknown> = {};
    if (payload.changes) meta.changes = payload.changes;
    if (payload.metadata) Object.assign(meta, payload.metadata);

    const log = await this.db.activityLog.create({
      data: {
        parentLogId: this.cls.get('parentLogId') ?? null,
        userId: this.cls.get('userId') ?? null,
        actorLabel: this.cls.get('actorLabel') ?? null,
        source: payload.source ?? 'SYSTEM',
        level: payload.level ?? 'info',
        action: payload.action,
        entityType: payload.entityType ?? null,
        entityId: payload.entityId ?? null,
        message: payload.message ?? null,
        stack: payload.stack ?? null,
        metadata: Object.keys(meta).length
          ? (meta as Prisma.InputJsonValue)
          : undefined,
      },
    });
    return log.id;
  }

  /**
   * Create a root log for this request and store its ID in CLS.
   * All subsequent record() calls within this request will become children.
   */
  async recordRoot(payload: ActivityPayload): Promise<string> {
    const id = await this.record(payload);
    this.cls.set('parentLogId', id);
    return id;
  }
}
