import {
  Inject,
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { AccessService } from '../auth/access/access.service';
import { CATALOG_VERSION } from '../auth/permissions';
import { AppConfigService } from '../config/app-config.service';
import { DatabaseService } from '../database/database.service';
import {
  APP_ACCESS_TTL_SECONDS,
  appAccessKey,
  EVENTS_CHANNEL,
  parseEvent,
  STORE_VERSION,
  type StoreEvent,
  type StoredAppAccess,
} from '../session-store/contract';
import {
  SESSION_STORE,
  type SessionStore,
} from '../session-store/session-store';

/** People kept at most in the guard's cache (oldest dropped first). */
const ACCESS_CACHE_LIMIT = 5000;

/**
 * People's roles and permissions in Diffusion (Diffusion owns them, as every app of the
 * platform). Computed from Diffusion's tables for the guard, and published to the session store
 * (appAccessKey) with an event on EVENTS_CHANNEL each time they change, so the core's launcher and
 * console show who may open Diffusion. Permissions are the person's codes in their company (roles
 * of that company and delegations in force there, normalised).
 */
@Injectable()
export class AppAccessService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(AppAccessService.name);
  private unsubscribe: (() => void) | null = null;
  private readonly cache = new Map<
    string,
    { access: StoredAppAccess | undefined; at: number }
  >();

  constructor(
    private readonly database: DatabaseService,
    private readonly access: AccessService,
    @Inject(SESSION_STORE) private readonly store: SessionStore,
    private readonly config: AppConfigService,
  ) {}

  private get appId(): string {
    return this.config.get('CORE_APP_ID');
  }

  onModuleInit(): void {
    // Every instance hears every change (its own included).
    this.unsubscribe = this.store.subscribe(EVENTS_CHANNEL, (raw) => {
      const event = parseEvent(raw);
      if (event?.appId === this.appId) this.forget(event.userIds);
    });
  }

  onModuleDestroy(): void {
    this.unsubscribe?.();
  }

  /** People's access as Diffusion's tables give it now (no roles: an empty list). */
  async compute(userIds: string[]): Promise<Map<string, StoredAppAccess>> {
    const users = await this.database.user.findMany({
      where: { id: { in: userIds } },
      select: {
        id: true,
        companyId: true,
        userRoles: {
          where: { role: { archivedAt: null } },
          select: {
            role: { select: { id: true, name: true, companyId: true } },
          },
        },
      },
    });
    const now = new Date().toISOString();
    const result = new Map<string, StoredAppAccess>();
    for (const user of users) {
      // Only the roles of their company count (a role belongs to one company).
      const roles = new Map(
        user.userRoles
          .filter(({ role }) => role.companyId === user.companyId)
          .map(({ role }) => [role.id, role.name]),
      );
      result.set(user.id, {
        v: STORE_VERSION,
        appId: this.appId,
        userId: user.id,
        tenantId: user.companyId ?? '',
        roles: [...roles]
          .map(([id, name]) => ({ id, name }))
          .sort((a, b) => a.name.localeCompare(b.name)),
        permissions: user.companyId
          ? [
              ...(await this.access.computePermissions(
                user.id,
                user.companyId,
              )),
            ].sort()
          : [],
        catalogVersion: CATALOG_VERSION,
        updatedAt: now,
      });
    }
    return result;
  }

  /**
   * The guard's answer for one person: computed from the tables and healed into the store, then
   * reused for ACCESS_CACHE_SECONDS. Undefined: no Diffusion account.
   */
  async forRequest(
    userId: string,
    stored: StoredAppAccess | null,
  ): Promise<StoredAppAccess | undefined> {
    const ttl = this.config.get('ACCESS_CACHE_SECONDS') * 1000;
    const hit = this.cache.get(userId);
    if (ttl > 0 && hit && Date.now() - hit.at < ttl) return hit.access;
    const access = (await this.compute([userId])).get(userId);
    if (access) await this.heal(access, stored);
    if (ttl > 0) {
      this.cache.delete(userId);
      if (this.cache.size >= ACCESS_CACHE_LIMIT) {
        const [oldest] = this.cache.keys();
        if (oldest) this.cache.delete(oldest);
      }
      this.cache.set(userId, { access, at: Date.now() });
    }
    return access;
  }

  /**
   * After roles or role holders changed: rewrites these people's records and announces it. A store
   * failure is logged, never thrown (the record heals at the person's next request).
   */
  async refresh(userIds: string[]): Promise<void> {
    this.forget(userIds);
    if (userIds.length === 0) return;
    const records = await this.compute(userIds);
    await this.publish([...records.values()]);
  }

  /** Drops cached answers: these people's, or everyone's. */
  forget(userIds?: readonly string[]): void {
    if (!userIds) {
      this.cache.clear();
      return;
    }
    for (const id of userIds) this.cache.delete(id);
  }

  private async heal(
    current: StoredAppAccess,
    stored: StoredAppAccess | null,
  ): Promise<void> {
    if (
      stored &&
      stored.catalogVersion === current.catalogVersion &&
      sameList(
        stored.roles.map((r) => `${r.id}:${r.name}`),
        current.roles.map((r) => `${r.id}:${r.name}`),
      ) &&
      sameList(stored.permissions, current.permissions)
    ) {
      return;
    }
    await this.publish([current]);
  }

  private async publish(records: StoredAppAccess[]): Promise<void> {
    if (records.length === 0) return;
    try {
      await this.store.write(
        records.map((record) => ({
          key: appAccessKey(this.appId, record.userId),
          value: JSON.stringify(record),
          ttlSeconds: APP_ACCESS_TTL_SECONDS,
        })),
      );
      const byTenant = new Map<string, string[]>();
      for (const record of records) {
        byTenant.set(record.tenantId, [
          ...(byTenant.get(record.tenantId) ?? []),
          record.userId,
        ]);
      }
      for (const [tenantId, userIds] of byTenant) {
        const event: StoreEvent = {
          type: 'app-access.changed',
          appId: this.appId,
          tenantId,
          userIds,
        };
        await this.store.publish(EVENTS_CHANNEL, JSON.stringify(event));
      }
    } catch (error) {
      this.logger.warn(
        `access records not published: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
}

const sameList = (a: readonly string[], b: readonly string[]) =>
  a.length === b.length && a.every((value, i) => value === b[i]);
