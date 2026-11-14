/**
 * The Creapp session store (Redis): what a signed-in person may do, shared by every API of the
 * platform. The core writes sessions and people whenever something changes (sign-in, refresh,
 * sign-out, status, company settings, entitlements); each app reads them on every request.
 * Roles and permissions belong to each app (Part 14): the app writes the person's access to it
 * (`appAccessKey`) and announces every change on EVENTS_CHANNEL.
 *
 * KEEP THIS FILE IDENTICAL in every repository that uses the store:
 *   creapp-core-api/src/session-store/contract.ts         (writes and reads)
 *   creapp-api-v2/src/session-store/contract.ts           (Besoin, reads)
 *   creapp-ai-gateway/src/session-store/contract.ts       (reads)
 * A change of record shape bumps STORE_VERSION: readers ignore records of another version.
 */

export const STORE_VERSION = 1;

/** Every key starts with this: the Redis server may be shared with other software. */
export const KEY_PREFIX = 'creapp:v1:';

/** One open session (a sign-in on one device), keyed by the token's `sid`. */
export const sessionKey = (sessionId: string) =>
  `${KEY_PREFIX}session:${sessionId}`;
/** A company user: their company, its apps and their roles in each. */
export const userKey = (userId: string) => `${KEY_PREFIX}user:${userId}`;
/** A platform administrator (no company, no app access of their own). */
export const platformUserKey = (userId: string) =>
  `${KEY_PREFIX}platform-user:${userId}`;
/** A person's roles and permissions in one app, written by that app (it owns its roles). */
export const appAccessKey = (appId: string, userId: string) =>
  `${KEY_PREFIX}app-access:${appId}:${userId}`;
/** Publish/subscribe channel of StoreEvent messages (JSON). */
export const EVENTS_CHANNEL = `${KEY_PREFIX}events`;
/** How long an app keeps a person's access record without a change (it rewrites it on use). */
export const APP_ACCESS_TTL_SECONDS = 31 * 24 * 3600;

export interface StoredSession {
  v: typeof STORE_VERSION;
  sid: string;
  typ: 'tenant' | 'platform';
  /** The account the session belongs to (the token's `sub`). */
  sub: string;
  /** The company, for company users. */
  tid: string | null;
  /** How the person signed in: pwd, mfa, sso, imp. */
  amr: string[];
  /** "Sign in as": the platform administrator acting as `sub`. */
  impersonator: { id: string; name: string; email: string } | null;
  createdAt: string;
  /** The session's end at the latest (it may end earlier: sign-out, revocation). */
  expiresAt: string;
  /**
   * When a two-step code was last checked for a sensitive action (ISO); apps don't ask again for
   * STEP_UP_MINUTES (DS V2 7914:56424). Absent: never.
   */
  stepUpAt?: string | null;
}

/** A code checked for a sensitive action stays valid this long. */
export const STEP_UP_MINUTES = 10;

/** Whether the person can open an app of their company, and why not. */
export type AppAccess =
  /** Holds at least one role, the app is enabled and has an address. */
  | 'OPEN'
  /** The company uses the app, but this person has no role in it. */
  | 'NO_ROLE'
  /** Switched off by the platform. */
  | 'DISABLED'
  /** No live version with an address yet. */
  | 'UNAVAILABLE';

export interface StoredApp {
  /** The app's id in the catalog, e.g. "besoin". */
  id: string;
  name: string;
  description: string | null;
  /** Where the app opens (its manifest's baseUrl). */
  url: string | null;
  /** The app's icon (absolute address), when its manifest gives one. */
  icon: string | null;
  /**
   * For apps that own their roles, OPEN and NO_ROLE come from the app's access record (no record
   * yet: OPEN, the app decides).
   */
  access: AppAccess;
  roles: { id: string; name: string }[];
  /**
   * The union of the roles' permissions, "resource.action" (the app's own codes). Empty for apps
   * that own their roles: read their access record instead.
   */
  permissions: string[];
  /**
   * The app's live version the codes follow (absent in records written by an older core): an app
   * reading codes of an earlier version translates them.
   */
  version?: string | null;
}

/** A person's access to one app, written by the app (appAccessKey). */
export interface StoredAppAccess {
  v: typeof STORE_VERSION;
  appId: string;
  userId: string;
  tenantId: string;
  roles: { id: string; name: string }[];
  /** Effective codes (implied reads included). */
  permissions: string[];
  /** The app's permission catalog version these codes follow. */
  catalogVersion: string;
  updatedAt: string;
}

/** Messages on EVENTS_CHANNEL. */
export type StoreEvent = {
  /** Roles or role holders changed in an app: these people's access records were rewritten. */
  type: 'app-access.changed';
  appId: string;
  tenantId: string;
  userIds: string[];
};

/** A StoreEvent, or null when the message isn't one. */
export function parseEvent(raw: string): StoreEvent | null {
  try {
    const value = JSON.parse(raw) as StoreEvent;
    return value?.type === 'app-access.changed' && Array.isArray(value.userIds)
      ? value
      : null;
  } catch {
    return null;
  }
}

export interface StoredUser {
  v: typeof STORE_VERSION;
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  language: string;
  status: 'INVITED' | 'ACTIVE' | 'DEACTIVATED';
  tenantAdmin: boolean;
  mustChangePassword: boolean;
  tenant: {
    id: string;
    name: string;
    slug: string;
    status: 'ACTIVE' | 'SUSPENDED';
    currency: string;
    defaultLanguage: string;
    brandColor: string | null;
    requireMfa: boolean;
    requireMfaAdmins: boolean;
    /** Days a newly concerned person has to turn two-step verification on (absent: 0). */
    mfaGraceDays?: number;
    /** Actions asking for a code again, "<appId>:<action>" (absent: none). */
    mfaSensitive?: string[];
  };
  /** Two-step verification for this person (absent: records written before 2026-10-31). */
  mfa?: {
    /** One of their roles is in the policy's list. */
    roleRequired: boolean;
    /** Since when the policy requires it (ISO); the grace period counts from here. */
    requiredSince: string | null;
    /** Two-step verification is on: sensitive actions ask for a code (absent: unknown, off). */
    enabled?: boolean;
  };
  /** Every app the company may use, in name order, with this person's access to each. */
  apps: StoredApp[];
  updatedAt: string;
}

export interface StoredPlatformUser {
  v: typeof STORE_VERSION;
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  language: string;
  active: boolean;
  mustChangePassword: boolean;
  /** The System-Master; absent on records written before Part 15 (read from the database). */
  systemMaster?: boolean;
  /** Back-office codes of the administrator's role (Part 15). */
  permissions?: string[];
  updatedAt: string;
}

/** A stored record, or null when absent, unreadable or of another version. */
export function parseStored<T extends { v: number }>(
  raw: string | null | undefined,
): T | null {
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as T;
    return value?.v === STORE_VERSION ? value : null;
  } catch {
    return null;
  }
}

/**
 * The company user behind a session, if it may be used now: the session belongs to them and
 * hasn't ended, they are active and so is their company. Same rules as the core.
 */
export function activeTenantUser(
  session: StoredSession | null,
  user: StoredUser | null,
  claims: { sub: string; sid: string },
  now = Date.now(),
): StoredUser | null {
  if (!session || !user) return null;
  if (session.sid !== claims.sid || session.sub !== claims.sub) return null;
  if (session.typ !== 'tenant' || session.tid !== user.tenant.id) return null;
  if (Date.parse(session.expiresAt) <= now) return null;
  if (user.status !== 'ACTIVE' || user.tenant.status !== 'ACTIVE') return null;
  return user;
}

/**
 * The platform administrator behind a session, if it may be used now: the session belongs to
 * them and hasn't ended, and they are active. Same rules as the core.
 */
export function activePlatformUser(
  session: StoredSession | null,
  user: StoredPlatformUser | null,
  claims: { sub: string; sid: string },
  now = Date.now(),
): StoredPlatformUser | null {
  if (!session || !user) return null;
  if (session.sid !== claims.sid || session.sub !== claims.sub) return null;
  if (session.typ !== 'platform' || user.id !== session.sub) return null;
  if (Date.parse(session.expiresAt) <= now) return null;
  return user.active ? user : null;
}

/** The person's entry for one app, if they can open it. */
export function openApp(user: StoredUser, appId: string): StoredApp | null {
  const app = user.apps.find((a) => a.id === appId);
  return app?.access === 'OPEN' ? app : null;
}

/**
 * The person's entry for an app that owns its roles, if their company may use it (whatever
 * roles the core last saw: the app decides with its own).
 */
export function entitledApp(user: StoredUser, appId: string): StoredApp | null {
  const app = user.apps.find((a) => a.id === appId);
  return app && (app.access === 'OPEN' || app.access === 'NO_ROLE')
    ? app
    : null;
}
