import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import type { AuthUser } from '../types/auth-user.type';
import type { Permission } from '../permissions';
import { AccessService } from './access.service';
import {
  ANY_PERMISSIONS_KEY,
  type CompanySource,
  PERMISSIONS_KEY,
  PLATFORM_ADMIN_KEY,
  SAME_COMPANY_KEY,
} from './decorators';

/** 403 FORBIDDEN naming the missing code (the UI and the core read `code` and `params`). */
export function forbidden(permission: string): ForbiddenException {
  return new ForbiddenException({
    code: 'FORBIDDEN',
    message: `Missing permission: ${permission}`,
    params: { permission },
  });
}

/**
 * Enforces @RequirePermissions(...) (all) and @RequireAnyPermission(...) (any) against the
 * permissions CoreAuthGuard put on the request (the person's codes in their company), as EXPENZO's
 * PermissionsGuard; then @PlatformAdmin and the @SameCompany data isolation. Runs after
 * CoreAuthGuard (`@UseGuards(CoreAuthGuard, PermissionsGuard)`); no metadata, no check.
 */
@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly access: AccessService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const targets = [context.getHandler(), context.getClass()];
    const required = this.reflector.getAllAndOverride<Permission[] | undefined>(
      PERMISSIONS_KEY,
      targets,
    );
    const anyOf = this.reflector.getAllAndOverride<Permission[] | undefined>(
      ANY_PERMISSIONS_KEY,
      targets,
    );
    const platformOnly = this.reflector.getAllAndOverride<boolean | undefined>(
      PLATFORM_ADMIN_KEY,
      targets,
    );
    const sources = this.reflector.getAllAndOverride<
      CompanySource[] | undefined
    >(SAME_COMPANY_KEY, targets);
    if (!required?.length && !anyOf?.length && !platformOnly && !sources) {
      return true;
    }

    const request = context
      .switchToHttp()
      .getRequest<Request & { user?: AuthUser }>();
    const user = request.user;
    if (!user) throw new ForbiddenException('Missing authenticated user');
    const granted = user.permissions;
    const missing = required?.find((permission) => !granted.has(permission));
    if (missing) throw forbidden(missing);
    if (anyOf?.length && !anyOf.some((permission) => granted.has(permission))) {
      throw forbidden(anyOf[0]);
    }
    if (platformOnly && !user.platformAdmin) {
      throw new ForbiddenException({
        code: 'PLATFORM_ADMIN_ONLY',
        message:
          'Reserved to a Diffusion super-administrator: this is common to every company',
      });
    }
    if (sources) {
      const body = (request.body ?? {}) as Record<string, unknown>;
      for (const source of sources) {
        const id =
          'param' in source ? request.params[source.param] : body[source.body];
        if (typeof id === 'string' && id) {
          await this.access.assertSameCompany(user.sub, source.entity, id);
        }
      }
    }
    return true;
  }
}
