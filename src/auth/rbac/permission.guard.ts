import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Request } from 'express';
import { JwtPayload } from '../types/jwt-payload.type';
import {
  PERMISSION_METADATA_KEY,
  PermissionCode,
  PLATFORM_PERMISSIONS,
} from './rbac.constants';
import { RbacService } from './rbac.service';
import { PLATFORM_ONLY_METADATA_KEY } from './require-permission.decorator';
import { SITE_SCOPE_METADATA_KEY, SiteSource } from './site-scope.decorator';

// Runs after JwtAuthGuard (req.user must already be set). No-op if the
// route/controller carries no @RequirePermission metadata. With @SiteScope,
// the permission must be held at the targeted resource's site; without it,
// at any site. Platform permissions (and @PlatformOnly routes) need a
// global grant.
@Injectable()
export class PermissionGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly rbacService: RbacService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const required = this.reflector.getAllAndOverride<
      PermissionCode | PermissionCode[] | undefined
    >(PERMISSION_METADATA_KEY, [context.getHandler(), context.getClass()]);
    if (!required) {
      return true;
    }

    const request = context
      .switchToHttp()
      .getRequest<Request & { user?: JwtPayload }>();
    const user = request.user;
    if (!user) {
      throw new ForbiddenException('Missing authenticated user');
    }

    const permissions = Array.isArray(required) ? required : [required];
    const isPlatformOnly = this.reflector.getAllAndOverride<
      boolean | undefined
    >(PLATFORM_ONLY_METADATA_KEY, [context.getHandler(), context.getClass()]);

    const sources = this.reflector.getAllAndOverride<SiteSource[] | undefined>(
      SITE_SCOPE_METADATA_KEY,
      [context.getHandler(), context.getClass()],
    );
    const siteIds = sources ? await this.targetSites(sources, request) : [];

    for (const code of permissions) {
      const platformOnly = PLATFORM_PERMISSIONS.has(code) || isPlatformOnly;
      if (platformOnly) {
        if (!(await this.rbacService.hasGlobalPermission(user.sub, code))) {
          throw new ForbiddenException(
            `Reserved to platform administrators: ${code}`,
          );
        }
        continue;
      }

      const granted = siteIds.length
        ? (
            await Promise.all(
              siteIds.map((siteId) =>
                this.rbacService.hasPermissionAtSite(user.sub, code, siteId),
              ),
            )
          ).every(Boolean)
        : await this.rbacService.hasPermission(user.sub, code);

      if (!granted) {
        throw new ForbiddenException(
          siteIds.length
            ? `Missing permission at this site: ${code}`
            : `Missing permission: ${code}`,
        );
      }
    }

    return true;
  }

  // Sites of the resources the request targets. Missing ids and unknown
  // resources are skipped: the service then answers 400/404 as usual.
  private async targetSites(
    sources: SiteSource[],
    request: Request,
  ): Promise<string[]> {
    const body = (request.body ?? {}) as Record<string, unknown>;
    const siteIds = await Promise.all(
      sources.map(async (source) => {
        const id =
          'param' in source ? request.params[source.param] : body[source.body];
        return typeof id === 'string' && id
          ? this.rbacService.resolveSiteId(source.entity, id)
          : null;
      }),
    );
    return [...new Set(siteIds.filter((id): id is string => !!id))];
  }
}
