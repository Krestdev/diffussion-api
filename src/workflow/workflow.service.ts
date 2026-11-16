import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ClsServiceManager } from 'nestjs-cls';
import type { AppClsStore } from '../cls.store';
import { forbidden } from '../auth/access/permissions.guard';
import { TransitionTable } from './transition-table';

/** The minimal slice of a Prisma model delegate the engine needs. */
export interface StatusDelegate {
  findFirst(args: {
    where: { id: string };
    select: Record<string, true>;
  }): Promise<Record<string, unknown> | null>;
  updateMany(args: {
    where: Record<string, unknown>;
    data: Record<string, unknown>;
  }): Promise<{ count: number }>;
}

/** Where the StatusHistory rows go: the caller's transaction (or the client itself). */
export interface HistoryWriter {
  statusHistory: {
    create(args: { data: Record<string, unknown> }): Promise<unknown>;
  };
}

export interface TransitionRequest<S extends string, E extends string> {
  table: TransitionTable<S, E>;
  delegate: StatusDelegate;
  entityId: string;
  event: E;
  /**
   * The status the caller has just read (it then is not read again): the update stays
   * conditional on it, so a concurrent change is still refused.
   */
  from?: S;
  /** Target status, required when the event's rule lists several. */
  to?: S;
  reason?: string | null;
  /** Extra columns written in the same conditional update (e.g. signedAt). */
  data?: Record<string, unknown>;
  /** The entity's company (StatusHistory.companyId); the person's otherwise. */
  companyId?: string | null;
  /**
   * A scheduled job or a cascade (project closed, effet closed…): no permission is checked
   * and no actor is recorded, the change is the system's.
   */
  system?: boolean;
}

export interface TransitionResult<S extends string> {
  from: S;
  to: S;
}

/** 409 INVALID_TRANSITION: `event` is not allowed from the entity's status. */
export function invalidTransition(
  entity: string,
  from: string,
  event: string,
): ConflictException {
  return new ConflictException({
    code: 'INVALID_TRANSITION',
    message: `${entity} is ${from}: ${event} is not allowed`,
    params: { entity, from, event },
  });
}

function cls() {
  const service = ClsServiceManager.getClsService<AppClsStore>();
  return service.isActive() ? service : null;
}

/**
 * Diffusion's workflow engine, as EXPENZO's: every status change of a workflow entity goes
 * through `transition`, which checks the entity's table (and the permission its rule names),
 * applies the change conditionally on the status read and records it in StatusHistory.
 * Designation checks (supervisor, validator, executant…) stay in the services.
 */
@Injectable()
export class WorkflowService {
  /** Refuses with 409 INVALID_TRANSITION unless `event` may be triggered from `from`. */
  assertAllowed<S extends string, E extends string>(
    table: TransitionTable<S, E>,
    from: S,
    event: E,
  ): void {
    if (!table.allows(from, event)) {
      throw invalidTransition(table.entity, from, event);
    }
  }

  /**
   * Applies one status transition inside the caller's transaction. The update is conditional
   * on the status read beforehand, so a concurrent or repeated call cannot apply twice.
   */
  async transition<S extends string, E extends string>(
    tx: HistoryWriter,
    request: TransitionRequest<S, E>,
  ): Promise<TransitionResult<S>> {
    const { table, delegate, entityId, event } = request;
    let from = request.from;
    if (from === undefined) {
      const current = await delegate.findFirst({
        where: { id: entityId },
        select: { [table.field]: true },
      });
      if (!current) throw new NotFoundException(`${table.entity} not found`);
      from = current[table.field] as S;
    }

    const rule = table.resolve(from, event);
    if (!rule) throw invalidTransition(table.entity, from, event);

    const to = table.target(rule, request.to);
    const store = cls();
    if (rule.permission && !request.system) {
      const held = store?.get('permissions') ?? [];
      if (!held.includes(rule.permission)) throw forbidden(rule.permission);
    }

    const { count } = await delegate.updateMany({
      where: { id: entityId, [table.field]: from },
      data: { ...request.data, [table.field]: to },
    });
    if (count !== 1) {
      throw new ConflictException({
        code: 'CONCURRENT_UPDATE',
        message: `${table.entity} changed in the meantime: reload it`,
        params: { entity: table.entity },
      });
    }

    await tx.statusHistory.create({
      data: {
        companyId:
          request.companyId !== undefined
            ? request.companyId
            : (store?.get('companyId') ?? null),
        entity: table.entity,
        entityId,
        field: table.field,
        fromStatus: from,
        toStatus: to,
        event,
        actorId: request.system ? null : (store?.get('userId') ?? null),
        reason: request.reason ?? null,
        ip: request.system ? null : (store?.get('ip') ?? null),
      },
    });
    return { from, to };
  }

  /** Records the status an entity is created in (no previous status). */
  async record<S extends string, E extends string>(
    tx: HistoryWriter,
    request: {
      table: TransitionTable<S, E>;
      entityId: string;
      toStatus: S;
      event?: string;
      reason?: string | null;
      companyId?: string | null;
      system?: boolean;
    },
  ): Promise<void> {
    const store = cls();
    await tx.statusHistory.create({
      data: {
        companyId:
          request.companyId !== undefined
            ? request.companyId
            : (store?.get('companyId') ?? null),
        entity: request.table.entity,
        entityId: request.entityId,
        field: request.table.field,
        fromStatus: null,
        toStatus: request.toStatus,
        event: request.event ?? 'CREATE',
        actorId: request.system ? null : (store?.get('userId') ?? null),
        reason: request.reason ?? null,
        ip: request.system ? null : (store?.get('ip') ?? null),
      },
    });
  }
}
