import type { INestApplication } from '@nestjs/common';
import { generateKeyPairSync, randomUUID, sign } from 'node:crypto';
import { AppConfigService } from '../src/config/app-config.service';
import {
  appAdminAudience,
  CORE_AUDIENCE,
  CoreJwks,
} from '../src/core/core-tokens.service';
import { DatabaseService } from '../src/database/database.service';
import {
  sessionKey,
  STORE_VERSION,
  type StoredSession,
  type StoredUser,
  userKey,
} from '../src/session-store/contract';
import {
  SESSION_STORE,
  type SessionStore,
} from '../src/session-store/session-store';

/**
 * Stands in for the CREAPP core in the e2e tests: an RSA key made in-process whose public half
 * replaces the core's JWKS, and tokens signed with it exactly as the core signs them (RS256, iss,
 * aud, sub, tid, sid, amr). It also writes the session store as the core does at sign-in, from
 * Diffusion's own copies (the person and their company = their company).
 */
export class LocalCoreSigner {
  private readonly kid = `local-${randomUUID().slice(0, 8)}`;
  private readonly keys = generateKeyPairSync('rsa', { modulusLength: 2048 });
  private app: INestApplication | null = null;
  private issuer = '';

  /** Makes the app trust this signer instead of the core. */
  install(app: INestApplication): this {
    this.app = app;
    this.issuer = app.get(AppConfigService).get('CORE_ISSUER');
    const jwk = this.keys.publicKey.export({ format: 'jwk' });
    app.get(CoreJwks).fetch = () =>
      Promise.resolve([
        {
          kty: 'RSA',
          kid: this.kid,
          use: 'sig',
          alg: 'RS256',
          n: jwk.n,
          e: jwk.e,
        },
      ]);
    return this;
  }

  /**
   * Signs a person in, as the core would: their session and record in the store (from
   * Diffusion's tables as they are now), then a token for that session.
   */
  async signIn(
    userId: string,
    options: {
      tenantAdmin?: boolean;
      /** Their company's access to Diffusion in the core (default OPEN). */
      access?: 'OPEN' | 'NO_ROLE' | 'DISABLED' | 'UNAVAILABLE';
      impersonator?: StoredSession['impersonator'];
    } = {},
  ): Promise<string> {
    if (!this.app) throw new Error('install() the signer first');
    const user = await this.app.get(DatabaseService).user.findUniqueOrThrow({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        name: true,
        status: true,
        company: { select: { id: true, name: true, code: true, status: true } },
      },
    });
    if (!user.company)
      throw new Error(`${user.email} has no company (company)`);
    const [firstName, ...rest] = user.name.split(' ');
    const now = new Date();
    const record: StoredUser = {
      v: STORE_VERSION,
      id: user.id,
      email: user.email,
      firstName,
      lastName: rest.join(' '),
      language: 'fr',
      status: user.status === 'ACTIVE' ? 'ACTIVE' : 'DEACTIVATED',
      tenantAdmin: options.tenantAdmin ?? false,
      mustChangePassword: false,
      tenant: {
        id: user.company.id,
        name: user.company.name,
        slug: user.company.code.toLowerCase(),
        status: user.company.status === 'ACTIVE' ? 'ACTIVE' : 'SUSPENDED',
        currency: 'XAF',
        defaultLanguage: 'fr',
        brandColor: null,
        requireMfa: false,
        requireMfaAdmins: false,
      },
      apps: [
        {
          id: this.app.get(AppConfigService).get('CORE_APP_ID'),
          name: 'Diffusion',
          description: null,
          url: 'http://localhost:4000',
          icon: null,
          access: options.access ?? 'OPEN',
          roles: [],
          permissions: [],
        },
      ],
      updatedAt: now.toISOString(),
    };
    const sid = randomUUID();
    const session: StoredSession = {
      v: STORE_VERSION,
      sid,
      typ: 'tenant',
      sub: record.id,
      tid: record.tenant.id,
      amr: options.impersonator ? ['imp'] : ['pwd'],
      impersonator: options.impersonator ?? null,
      createdAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + 3_600_000).toISOString(),
    };
    await this.app.get<SessionStore>(SESSION_STORE).write([
      {
        key: sessionKey(sid),
        value: JSON.stringify(session),
        ttlSeconds: 3600,
      },
      {
        key: userKey(record.id),
        value: JSON.stringify(record),
        ttlSeconds: 3600,
      },
    ]);
    return this.token(record.id, record.tenant.id, { sid });
  }

  /** A core access token (10 minutes, like the core's). */
  token(
    userId: string,
    companyId: string,
    overrides: Record<string, unknown> = {},
  ): string {
    const now = Math.floor(Date.now() / 1000);
    return this.signed({
      sub: userId,
      tid: companyId,
      sid: randomUUID(),
      typ: 'tenant',
      amr: ['pwd'],
      iss: this.issuer,
      aud: CORE_AUDIENCE,
      iat: now,
      exp: now + 600,
      ...overrides,
    });
  }

  /** A core app-admin token for Diffusion (the console managing a company's roles, 1 minute). */
  appAdmin(companyId: string, overrides: Record<string, unknown> = {}): string {
    if (!this.app) throw new Error('install() the signer first');
    const now = Math.floor(Date.now() / 1000);
    return this.signed({
      sub: randomUUID(),
      name: 'console@e2e.test',
      tid: companyId,
      platform: false,
      typ: 'app-admin',
      iss: this.issuer,
      aud: appAdminAudience(this.app.get(AppConfigService).get('CORE_APP_ID')),
      iat: now,
      exp: now + 60,
      ...overrides,
    });
  }

  private signed(claims: object): string {
    const encode = (value: object) =>
      Buffer.from(JSON.stringify(value)).toString('base64url');
    const input = `${encode({ alg: 'RS256', typ: 'JWT', kid: this.kid })}.${encode(claims)}`;
    const signature = sign('sha256', Buffer.from(input), this.keys.privateKey);
    return `${input}.${signature.toString('base64url')}`;
  }
}
