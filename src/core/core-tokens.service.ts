import { Injectable, Logger } from '@nestjs/common';
import { createPublicKey, KeyObject, verify } from 'node:crypto';
import { AppConfigService } from '../config/app-config.service';

/** The claims of a core access token that Diffusion uses. */
export interface CoreClaims {
  /** The user's id (the same in the core and in Diffusion). */
  sub: string;
  /** The company's id; absent for platform administrators, who have no Diffusion account. */
  tid?: string;
  /** The core session. */
  sid: string;
  typ: 'tenant' | 'platform';
  /** How the user signed in: pwd, mfa, sso, or imp ("sign in as" by a platform administrator). */
  amr: string[];
  /** The platform administrator acting as `sub` ("sign in as"). */
  act?: { sub: string };
}

/** Every core access token is for the Creapp platform. */
export const CORE_AUDIENCE = 'creapp';
/** The audience of the core's app-admin tokens for one app (Part 14). */
export const appAdminAudience = (appId: string) => `creapp-app:${appId}`;
/** An app-admin token lives this long at most (the core makes one per call). */
const APP_ADMIN_MAX_SECONDS = 300;

/**
 * A core console call to an app's app-admin API (Part 14): who acts (a company administrator or
 * a platform administrator), for which company. The core checked their right to manage the
 * company's roles before signing.
 */
export interface AppAdminClaims {
  /** The core user or platform administrator acting. */
  sub: string;
  /** Their display name (for the audit log). */
  name: string;
  /** The company whose roles are managed. */
  tid: string;
  platform: boolean;
}
/** Seconds of clock difference tolerated with the core. */
const LEEWAY_SECONDS = 30;
/** An unknown key id re-reads the keys, at most this often (a forged kid can't flood the core). */
const REFETCH_MS = 30_000;

export class CoreTokenError extends Error {}

interface Jwk {
  kty: string;
  kid?: string;
  alg?: string;
  use?: string;
  n?: string;
  e?: string;
}

/** The core's public keys (its JWKS). Replaced in the e2e tests by a local test key. */
@Injectable()
export class CoreJwks {
  constructor(private readonly config: AppConfigService) {}

  async fetch(): Promise<Jwk[]> {
    const url = new URL('/.well-known/jwks.json', this.config.get('CORE_URL'));
    const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
    if (!res.ok) throw new Error(`JWKS answered ${res.status}`);
    const body = (await res.json()) as { keys?: Jwk[] };
    return body.keys ?? [];
  }
}

const decode = <T>(part: string): T => {
  try {
    return JSON.parse(Buffer.from(part, 'base64url').toString('utf8')) as T;
  } catch {
    throw new CoreTokenError('Malformed token');
  }
};

/**
 * Checks core access tokens (RS256) with the core's public keys only: no secret is shared.
 * Keys are cached and re-read when a token names a key not seen yet (rotation).
 */
@Injectable()
export class CoreTokensService {
  private readonly logger = new Logger(CoreTokensService.name);
  private keys = new Map<string, KeyObject>();
  private fetchedAt = 0;
  private pending: Promise<void> | null = null;

  constructor(
    private readonly jwks: CoreJwks,
    private readonly config: AppConfigService,
  ) {}

  async verify(token: string): Promise<CoreClaims> {
    const claims = await this.verified(token);
    if (claims.aud !== CORE_AUDIENCE)
      throw new CoreTokenError('Wrong audience');
    if (typeof claims.sub !== 'string' || typeof claims.sid !== 'string') {
      throw new CoreTokenError('Missing claims');
    }
    return {
      sub: claims.sub,
      tid: claims.tid,
      sid: claims.sid,
      typ: claims.typ === 'platform' ? 'platform' : 'tenant',
      amr: Array.isArray(claims.amr) ? claims.amr : [],
      act: claims.act,
    };
  }

  /** A core console call to the app's app-admin API (never an access token: other audience). */
  async verifyAppAdmin(token: string, appId: string): Promise<AppAdminClaims> {
    const claims = await this.verified(token);
    if (claims.aud !== appAdminAudience(appId))
      throw new CoreTokenError('Wrong audience');
    if (claims.typ !== 'app-admin') throw new CoreTokenError('Wrong type');
    if (
      typeof claims.iat !== 'number' ||
      claims.exp! - claims.iat > APP_ADMIN_MAX_SECONDS
    ) {
      throw new CoreTokenError('Lifetime too long');
    }
    if (typeof claims.sub !== 'string' || typeof claims.tid !== 'string') {
      throw new CoreTokenError('Missing claims');
    }
    return {
      sub: claims.sub,
      tid: claims.tid,
      name: typeof claims.name === 'string' ? claims.name : claims.sub,
      platform: claims.platform === true,
    };
  }

  /** Signature, issuer and dates of any core token; its claims for the caller to check. */
  private async verified(token: string) {
    const parts = token.split('.');
    if (parts.length !== 3) throw new CoreTokenError('Malformed token');
    const [header, payload, signature] = parts;
    const head = decode<{ alg?: string; kid?: string }>(header);
    // Only RS256: "none" or HS256 with the public key as a secret are refused.
    if (head.alg !== 'RS256' || typeof head.kid !== 'string') {
      throw new CoreTokenError('Unsupported token header');
    }
    const key = await this.key(head.kid);
    const valid = verify(
      'sha256',
      Buffer.from(`${header}.${payload}`),
      key,
      Buffer.from(signature, 'base64url'),
    );
    if (!valid) throw new CoreTokenError('Bad signature');

    const claims = decode<
      Partial<Omit<CoreClaims, 'typ'>> & {
        typ?: string;
        iss?: string;
        aud?: string;
        exp?: number;
        iat?: number;
        name?: string;
        platform?: boolean;
      }
    >(payload);
    const now = Math.floor(Date.now() / 1000);
    if (claims.iss !== this.config.get('CORE_ISSUER')) {
      // Both are public addresses: says which setting to fix (CORE_ISSUER = the core's APP_URL).
      throw new CoreTokenError(
        `Wrong issuer: ${String(claims.iss)}, CORE_ISSUER is ${this.config.get('CORE_ISSUER')}`,
      );
    }
    if (typeof claims.exp !== 'number' || claims.exp + LEEWAY_SECONDS < now) {
      throw new CoreTokenError('Expired');
    }
    if (typeof claims.iat === 'number' && claims.iat - LEEWAY_SECONDS > now) {
      throw new CoreTokenError('Issued in the future');
    }
    return claims;
  }

  private async key(kid: string): Promise<KeyObject> {
    const known = this.keys.get(kid);
    if (known) return known;
    if (Date.now() - this.fetchedAt >= REFETCH_MS) await this.refresh();
    const key = this.keys.get(kid);
    if (!key) throw new CoreTokenError('Unknown signing key');
    return key;
  }

  /** One read at a time, however many requests arrive with the new key. */
  private refresh(): Promise<void> {
    this.pending ??= (async () => {
      try {
        const keys = await this.jwks.fetch();
        const next = new Map<string, KeyObject>();
        for (const jwk of keys) {
          if (jwk.kty !== 'RSA' || !jwk.kid || !jwk.n || !jwk.e) continue;
          if (jwk.use && jwk.use !== 'sig') continue;
          next.set(
            jwk.kid,
            createPublicKey({
              key: { kty: 'RSA', n: jwk.n, e: jwk.e },
              format: 'jwk',
            }),
          );
        }
        this.keys = next;
      } catch (error) {
        this.logger.warn(
          `core keys unavailable: ${error instanceof Error ? error.message : String(error)}`,
        );
      } finally {
        this.fetchedAt = Date.now();
        this.pending = null;
      }
    })();
    return this.pending;
  }
}
