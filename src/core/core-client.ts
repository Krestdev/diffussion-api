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
    }[];
  }[];
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
