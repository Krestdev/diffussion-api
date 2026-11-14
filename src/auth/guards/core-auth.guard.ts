import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import type { Request } from 'express';
import { ClsService } from 'nestjs-cls';
import { AppClsStore } from '../../cls.store';
import {
  CoreAccessService,
  SessionStoreUnavailable,
} from '../../core/core-access.service';
import { AuthUser, CoreRequestContext } from '../types/auth-user.type';

/** The core's access cookie (set by the core on the platform's parent domain). */
export const ACCESS_COOKIE = 'creapp_access';

/** A cookie's value from a Cookie header. */
export function readCookie(
  header: string | undefined,
  name: string,
): string | undefined {
  for (const part of (header ?? '').split(';')) {
    const at = part.indexOf('=');
    if (at < 0) continue;
    if (part.slice(0, at).trim() === name) {
      try {
        return decodeURIComponent(part.slice(at + 1).trim());
      } catch {
        return undefined;
      }
    }
  }
  return undefined;
}

/** The core access token of a request: its cookie, else a Bearer header (server-side callers). */
export function accessToken(request: {
  headers: Record<string, string | string[] | undefined>;
}): string | undefined {
  const cookie = request.headers.cookie;
  const fromCookie = readCookie(
    Array.isArray(cookie) ? cookie.join(';') : cookie,
    ACCESS_COOKIE,
  );
  if (fromCookie) return fromCookie;
  const authorization = request.headers.authorization;
  return /^Bearer (\S+)$/.exec(
    Array.isArray(authorization) ? authorization[0] : (authorization ?? ''),
  )?.[1];
}

/**
 * Every protected route: a core access token whose session the session store confirms, for a
 * person whose company may use Diffusion and who holds a Diffusion role. 401 UNAUTHENTICATED (the
 * UI refreshes at the core, then sends to the core's sign-in), 403 NO_APP_ACCESS (signed in, but
 * nothing to do in Diffusion), 503 SESSION_STORE_UNAVAILABLE.
 */
@Injectable()
export class CoreAuthGuard implements CanActivate {
  constructor(
    private readonly access: CoreAccessService,
    private readonly cls: ClsService<AppClsStore>,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context
      .switchToHttp()
      .getRequest<Request & { user?: AuthUser; core?: CoreRequestContext }>();
    const token = accessToken(request);
    if (!token) {
      throw new UnauthorizedException({
        code: 'UNAUTHENTICATED',
        message: 'Sign in at the CREAPP platform',
      });
    }
    let result: Awaited<ReturnType<CoreAccessService['resolve']>>;
    try {
      result = await this.access.resolve(token);
    } catch (error) {
      if (error instanceof SessionStoreUnavailable) {
        throw new ServiceUnavailableException({
          code: 'SESSION_STORE_UNAVAILABLE',
          message: 'Sessions cannot be checked right now, please retry',
        });
      }
      throw error;
    }
    if (result === 'unauthenticated') {
      throw new UnauthorizedException({
        code: 'UNAUTHENTICATED',
        message: 'Your session has ended: sign in again',
      });
    }
    if (result === 'no-access') {
      throw new ForbiddenException({
        code: 'NO_APP_ACCESS',
        message: 'You have no access to Diffusion',
      });
    }
    const { account, session } = result;
    const impersonator = session.impersonator
      ? { name: session.impersonator.name, email: session.impersonator.email }
      : null;
    request.user = {
      sub: account.id,
      email: account.email,
      name: `${account.firstName} ${account.lastName}`.trim(),
      siteId: account.tenant.id,
      sid: session.sid,
      impersonator,
    };
    request.core = { account, session };
    this.cls.set('userId', account.id);
    this.cls.set(
      'actorLabel',
      impersonator
        ? `${impersonator.email} (as ${account.email})`.slice(0, 100)
        : account.email,
    );
    return true;
  }
}
