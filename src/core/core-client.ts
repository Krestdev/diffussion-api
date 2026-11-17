import { Injectable } from '@nestjs/common';
import { AppConfigService } from '../config/app-config.service';

/**
 * GET /apps/self/directory: what Diffusion keeps a copy of (see the core's DirectoryService).
 * Only the fields Diffusion uses; the core sends more (org units, projects, identity...).
 */
export interface CoreDirectory {
  version: string;
  /** The app's live version (informative). */
  appVersion?: string | null;
  tenants: {
    id: string;
    name: string;
    slug: string;
    status: 'ACTIVE' | 'SUSPENDED';
    users: {
      id: string;
      email: string;
      firstName: string;
      lastName: string;
      phone: string | null;
      jobTitle: string | null;
      language: string;
      status: 'INVITED' | 'ACTIVE' | 'DEACTIVATED';
      tenantAdmin: boolean;
      /** Last sign-in to the platform, rounded down to the hour (ISO); null: never. */
      lastSignInAt?: string | null;
      /**
       * Deleted in the core with their history kept (C9): sent with status DEACTIVATED (ISO);
       * null or absent (older cores): not deleted.
       */
      deletedAt?: string | null;
    }[];
    /**
     * The company's projects, once the core owns them (Tenant.projectsSince): Diffusion keeps
     * read-only copies (project-sync.ts). Absent: the core doesn't own them yet.
     */
    projects?: CoreProject[];
  }[];
}

/** A project of the core (contract C8, DS V2 « Projets »), as the directory sends it. */
export interface CoreProject {
  id: string;
  reference: string;
  name: string;
  description: string | null;
  /** ONGOING (offered), SUSPENDED (offered, marked), CLOSED (no longer offered). */
  status: string;
  leaderId: string | null;
  orgUnitId: string | null;
  /** Days, "2026-12-01" or an ISO timestamp. */
  startsOn: string | null;
  endsOn: string | null;
  budget: string | null;
}

export interface CorePage<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}

/** GET /apps/self/tenants/:id/access-events: one sign-in, device, session or core audit action. */
export interface CoreAccessEvent {
  id: string;
  at: string;
  kind:
    | 'SIGN_IN_SUCCESS'
    | 'SIGN_IN_FAILURE'
    | 'SIGN_IN_LOCKED'
    | 'NEW_DEVICE'
    | 'SESSION_TIMED_OUT'
    | 'AUDIT';
  action: string | null;
  userId: string | null;
  userName: string | null;
  actorLabel: string | null;
  targetLabel: string | null;
  failures: number | null;
  userAgent: string | null;
  ip: string | null;
  data: unknown;
}

/** GET /apps/self/tenants/:id/access-summary (the last 7 days). */
export interface CoreAccessSummary {
  signIns: number;
  activeUsers: number;
  failed: number;
  failedUsers: number;
  newDevices: number;
  roleChanges: number;
  streaks: {
    userId: string;
    userName: string;
    failures: number;
    lockedUntil: string | null;
    lastAt: string | null;
    userAgent: string | null;
    ip: string | null;
  }[];
  rules: {
    lockAfter: number;
    lockMinutes: number;
    newDeviceVerified: boolean;
    sessionTimeoutHours: number;
  };
}

export class CoreUnavailableError extends Error {}

/** Calls to the core with Diffusion's app key. */
@Injectable()
export class CoreClient {
  constructor(private readonly config: AppConfigService) {}

  /** Whether Diffusion has a key to call the core with. */
  get configured(): boolean {
    return !!this.config.get('CORE_APP_KEY');
  }

  /** The directory, or null when it hasn't changed since `version`. */
  async directory(version?: string): Promise<CoreDirectory | null> {
    const res = await this.call('/api/v1/apps/self/directory', {
      headers: {
        authorization: `Bearer ${this.config.get('CORE_APP_KEY')}`,
        ...(version ? { 'if-none-match': `"${version}"` } : {}),
      },
    });
    if (res.status === 304) return null;
    if (!res.ok) throw new CoreUnavailableError(`directory: ${res.status}`);
    return (await res.json()) as CoreDirectory;
  }

  /**
   * A company's access events (sign-ins, wrong passwords, locks, new devices,
   * timed-out sessions, people/role/security actions in the core), newest first.
   */
  async accessEvents(
    tenantId: string,
    query: Record<string, string | number | undefined>,
  ): Promise<CorePage<CoreAccessEvent>> {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined && value !== '') params.set(key, String(value));
    }
    const res = await this.call(
      `/api/v1/apps/self/tenants/${encodeURIComponent(tenantId)}/access-events?${params}`,
      {
        headers: { authorization: `Bearer ${this.config.get('CORE_APP_KEY')}` },
      },
    );
    if (!res.ok) throw new CoreUnavailableError(`access-events: ${res.status}`);
    return (await res.json()) as CorePage<CoreAccessEvent>;
  }

  /** The last 7 days' access figures, current failure streaks and the access rules in force. */
  async accessSummary(tenantId: string): Promise<CoreAccessSummary> {
    const res = await this.call(
      `/api/v1/apps/self/tenants/${encodeURIComponent(tenantId)}/access-summary`,
      {
        headers: { authorization: `Bearer ${this.config.get('CORE_APP_KEY')}` },
      },
    );
    if (!res.ok) {
      throw new CoreUnavailableError(`access-summary: ${res.status}`);
    }
    return (await res.json()) as CoreAccessSummary;
  }

  /** A person's photo from the core (null: none). The caller checks they are in the viewer's company. */
  async photo(
    userId: string,
  ): Promise<{ contentType: string; bytes: Buffer } | null> {
    const res = await this.call(
      `/api/v1/apps/self/users/${encodeURIComponent(userId)}/photo`,
      {
        headers: { authorization: `Bearer ${this.config.get('CORE_APP_KEY')}` },
      },
    );
    if (res.status === 404) return null;
    if (!res.ok) throw new CoreUnavailableError(`photo: ${res.status}`);
    return {
      contentType: res.headers.get('content-type') ?? 'image/jpeg',
      bytes: Buffer.from(await res.arrayBuffer()),
    };
  }

  /** The user's interface language, changed in the core with their own token. */
  async setLanguage(token: string, language: string): Promise<void> {
    const res = await this.call('/api/v1/auth/me', {
      method: 'PATCH',
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ language }),
    });
    if (!res.ok) throw new CoreUnavailableError(`language: ${res.status}`);
  }

  private async call(path: string, init: RequestInit): Promise<Response> {
    try {
      return await fetch(new URL(path, this.config.get('CORE_URL')), {
        ...init,
        signal: AbortSignal.timeout(15_000),
      });
    } catch (error) {
      throw new CoreUnavailableError(
        error instanceof Error ? error.message : String(error),
      );
    }
  }
}
