import type { StoredSession, StoredUser } from '../../session-store/contract';

/**
 * The signed-in person, set on `request.user` by CoreAuthGuard from the core's access token and
 * the session store. `sub` is their id (the same in the core and in Diffusion).
 */
export type AuthUser = {
  sub: string;
  email: string;
  name: string;
  /** Their company (the core's, same id in Diffusion). */
  companyId: string;
  /** The core session. */
  sid: string;
  /** "Sign in as": the platform administrator acting as this person. */
  impersonator: { name: string; email: string } | null;
  /** Their permission codes in their company (roles and delegations, normalised). */
  permissions: ReadonlySet<string>;
  /** A Diffusion super-administrator (profile SUPER_ADMIN): manages what every company shares. */
  platformAdmin: boolean;
  /**
   * A call from the core's console (app-admin API): the company or platform administrator the
   * core authorised; they act with every permission in the token's company.
   */
  coreActor?: { name: string; platform: boolean };
};

/** What the core said about the caller, on `request.core` (for /auth/me). */
export type CoreRequestContext = {
  account: StoredUser;
  session: StoredSession;
};
