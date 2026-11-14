import type { StoredSession, StoredUser } from '../../session-store/contract';

/**
 * The signed-in person, set on `request.user` by CoreAuthGuard from the core's access token and
 * the session store. `sub` is their id (the same in the core and in Diffusion).
 */
export type AuthUser = {
  sub: string;
  email: string;
  name: string;
  /** Their company in the core, which is their Diffusion site. */
  siteId: string;
  /** The core session. */
  sid: string;
  /** "Sign in as": the platform administrator acting as this person. */
  impersonator: { name: string; email: string } | null;
};

/** What the core said about the caller, on `request.core` (for /auth/me). */
export type CoreRequestContext = {
  account: StoredUser;
  session: StoredSession;
};
