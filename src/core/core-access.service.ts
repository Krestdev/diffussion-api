import { Inject, Injectable, Logger } from '@nestjs/common';
import { UserStatus } from '../../generated/prisma/client';
import { AppConfigService } from '../config/app-config.service';
import { DatabaseService } from '../database/database.service';
import {
  activeTenantUser,
  appAccessKey,
  entitledApp,
  parseStored,
  sessionKey,
  type StoredAppAccess,
  type StoredSession,
  type StoredUser,
  userKey,
} from '../session-store/contract';
import {
  SESSION_STORE,
  type SessionStore,
} from '../session-store/session-store';
import { AppAccessService } from './app-access.service';
import { CoreClaims, CoreTokensService } from './core-tokens.service';
import {
  DirectorySyncService,
  setUpAdmins,
  upsertPerson,
  upsertSite,
} from './directory-sync.service';

export type AccessResult =
  | {
      account: StoredUser;
      session: StoredSession;
      claims: CoreClaims;
    }
  /** No valid token, or a session the store doesn't hold (ended, or to refresh at the core). */
  | 'unauthenticated'
  /** Signed in, but no role in Diffusion (or not a company user, or company not entitled). */
  | 'no-access';

export class SessionStoreUnavailable extends Error {}

/**
 * Who is calling, on every request: the core's token (signature), then the session store (the
 * session is open, the person and their company are active, the company may use Diffusion), then
 * Diffusion's own roles.
 */
@Injectable()
export class CoreAccessService {
  /** People whose local copy exists, for the directory generation it was checked in. */
  private readonly copied = new Map<string, number>();
  private readonly logger = new Logger(CoreAccessService.name);

  constructor(
    private readonly tokens: CoreTokensService,
    @Inject(SESSION_STORE) private readonly store: SessionStore,
    private readonly sync: DirectorySyncService,
    private readonly database: DatabaseService,
    private readonly config: AppConfigService,
    private readonly appAccess: AppAccessService,
  ) {}

  async resolve(token: string): Promise<AccessResult> {
    let claims: CoreClaims;
    try {
      claims = await this.tokens.verify(token);
    } catch (error) {
      // Expired tokens are routine (the UI refreshes at the core); anything else is a setting
      // to fix (CORE_ISSUER, CORE_URL), and every request is refused until it is.
      const reason = error instanceof Error ? error.message : String(error);
      if (reason !== 'Expired')
        this.logger.warn(`core token refused: ${reason}`);
      return 'unauthenticated';
    }
    // Platform administrators have no Diffusion account; "sign in as" gives them a company user's.
    if (claims.typ !== 'tenant' || !claims.tid) return 'no-access';

    let raw: (string | null)[];
    try {
      raw = await this.store.read([
        sessionKey(claims.sid),
        userKey(claims.sub),
        appAccessKey(this.config.get('CORE_APP_ID'), claims.sub),
      ]);
    } catch {
      throw new SessionStoreUnavailable();
    }
    const session = parseStored<StoredSession>(raw[0]);
    const stored = parseStored<StoredUser>(raw[1]);
    if (!session || !stored) {
      // Every request in this state points at REDIS_URL: not the core's session store.
      this.logger.warn(
        `session ${claims.sid} not in the session store (${!session ? 'session' : 'person'} missing): is REDIS_URL the core's store?`,
      );
      return 'unauthenticated';
    }
    const account = activeTenantUser(session, stored, claims);
    if (!account) return 'unauthenticated';
    if (account.tenant.id !== claims.tid) return 'no-access';
    // The company may use Diffusion; the person's roles are Diffusion's own.
    if (!entitledApp(account, this.config.get('CORE_APP_ID')))
      return 'no-access';
    if (!(await this.hasLocalCopy(account))) return 'no-access';
    const access = await this.appAccess.forRequest(
      account.id,
      parseStored<StoredAppAccess>(raw[2] ?? null),
    );
    if (!access || access.roles.length === 0) return 'no-access';
    return { account, session, claims };
  }

  /**
   * The person's active copy at their company's site (Diffusion's records point at it). New to
   * Diffusion: one directory sync first; when the sync can't provide it (no app key yet, core
   * unreachable), the copy is made from the session store's record, which the core wrote.
   */
  private async hasLocalCopy(account: StoredUser): Promise<boolean> {
    if (this.copied.get(account.id) === this.sync.generation) return true;
    const find = () =>
      this.database.user.count({
        where: {
          id: account.id,
          siteId: account.tenant.id,
          status: UserStatus.ACTIVE,
        },
      });
    if ((await find()) === 0) {
      await this.sync.syncSoon();
      if ((await find()) === 0) {
        await this.copyFromStore(account);
        if ((await find()) === 0) return false;
      }
    }
    this.copied.set(account.id, this.sync.generation);
    return true;
  }

  /** The company's site and the person, from the stored record. */
  private async copyFromStore(account: StoredUser): Promise<void> {
    try {
      const now = new Date();
      await this.database.$transaction(
        async (tx) => {
          await upsertSite(
            tx,
            account.tenant,
            now,
            this.config.get('CORE_SITE_LINKS'),
            this.logger,
          );
          await upsertPerson(
            tx,
            account.tenant.id,
            { ...account, phone: undefined, jobTitle: undefined },
            now,
            this.logger,
          );
          if (account.tenantAdmin) {
            await setUpAdmins(tx, account.tenant.id, [account.id]);
          }
        },
        { timeout: 60_000 },
      );
      this.logger.log(
        `${account.email} copied from the session store (no directory sync yet)`,
      );
    } catch (error) {
      this.logger.warn(
        `could not copy ${account.email} from the session store: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
}
