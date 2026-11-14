import { Global, Injectable, Module } from '@nestjs/common';

/**
 * The settings Diffusion reads from its environment to work on the CREAPP core: who signs people
 * in (the core), the shared session store, and Diffusion's own app id and key in the core's catalog.
 */
export interface AppConfig {
  NODE_ENV: string;
  /** The core API, e.g. https://admin-api.creaconsult-app.com (keys, directory). */
  CORE_URL: string;
  /** The `iss` of core tokens: the core's public address (its APP_URL). */
  CORE_ISSUER: string;
  /** Diffusion's id in the core's app catalog (its manifest's `id`). */
  CORE_APP_ID: string;
  /** The app key (cak_…) the core gave Diffusion; empty: no directory sync. */
  CORE_APP_KEY: string;
  /** How often the directory (companies, users) is read from the core. */
  CORE_SYNC_SECONDS: number;
  /** The session store the core writes (same Redis as the core's). */
  REDIS_URL: string;
  /** How long a person's computed roles are reused by the guard (0: every request). */
  ACCESS_CACHE_SECONDS: number;
  /**
   * Companies made in Diffusion before it moved onto the core, matched to the core's:
   * CORE_COMPANY_LINKS="<core company id>=<company id>,…" (otherwise the company of the same name).
   */
  CORE_COMPANY_LINKS: Record<string, string>;
}

const links = (value: string | undefined): Record<string, string> =>
  Object.fromEntries(
    (value ?? '')
      .split(',')
      .map((pair) => pair.split('=').map((part) => part.trim()))
      .filter((pair) => pair.length === 2 && pair[0] && pair[1]),
  ) as Record<string, string>;

const number = (value: string | undefined, fallback: number) => {
  const parsed = Number(value);
  return value !== undefined && value !== '' && Number.isFinite(parsed)
    ? parsed
    : fallback;
};

/** Read once at start-up; the core settings are required outside the tests. */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const config: AppConfig = {
    NODE_ENV: env.NODE_ENV ?? 'development',
    CORE_URL: (env.CORE_URL ?? '').trim(),
    CORE_ISSUER: (env.CORE_ISSUER ?? env.CORE_URL ?? '').trim(),
    CORE_APP_ID: (env.CORE_APP_ID ?? 'diffusion').trim(),
    CORE_APP_KEY: (env.CORE_APP_KEY ?? '').trim(),
    CORE_SYNC_SECONDS: Math.max(10, number(env.CORE_SYNC_SECONDS, 60)),
    REDIS_URL: (env.REDIS_URL ?? 'redis://localhost:6379').trim(),
    ACCESS_CACHE_SECONDS: Math.max(0, number(env.ACCESS_CACHE_SECONDS, 10)),
    CORE_COMPANY_LINKS: links(env.CORE_COMPANY_LINKS),
  };
  if (config.NODE_ENV !== 'test') {
    const missing = (['CORE_URL', 'CORE_ISSUER'] as const).filter(
      (key) => !config[key],
    );
    if (missing.length) {
      throw new Error(
        `Missing required environment variable(s): ${missing.join(', ')} (Diffusion signs people in through the CREAPP core)`,
      );
    }
  }
  return config;
}

@Injectable()
export class AppConfigService {
  private readonly values: AppConfig;

  constructor() {
    this.values = loadConfig();
  }

  get<K extends keyof AppConfig>(key: K): AppConfig[K] {
    return this.values[key];
  }
}

@Global()
@Module({
  providers: [AppConfigService],
  exports: [AppConfigService],
})
export class AppConfigModule {}
