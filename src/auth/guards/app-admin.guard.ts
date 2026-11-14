import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import type { Request } from 'express';
import { ClsService } from 'nestjs-cls';
import { AppClsStore } from '../../cls.store';
import { CoreAccessService } from '../../core/core-access.service';
import { ALL_PERMISSIONS } from '../permissions';
import { AuthUser } from '../types/auth-user.type';

/**
 * The app-admin API (the core's console): a Bearer app-admin token the core signed for Diffusion
 * (audience creapp-app:diffusion), naming the administrator acting and the company (tid). They act
 * with every permission within that company (the core checked their right); a person's access
 * token is refused here. 401 UNAUTHENTICATED otherwise (the core then shows Diffusion unavailable).
 */
@Injectable()
export class AppAdminGuard implements CanActivate {
  constructor(
    private readonly access: CoreAccessService,
    private readonly cls: ClsService<AppClsStore>,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context
      .switchToHttp()
      .getRequest<Request & { user?: AuthUser }>();
    const token = /^Bearer (\S+)$/.exec(
      request.headers.authorization ?? '',
    )?.[1];
    const resolved = token ? await this.access.resolveAppAdmin(token) : null;
    if (!resolved) {
      throw new UnauthorizedException({
        code: 'UNAUTHENTICATED',
        message: 'A core-signed app-admin token is required',
      });
    }
    const { claims } = resolved;
    const coreActor = { name: claims.name, platform: claims.platform };
    request.user = {
      sub: claims.sub,
      email: '',
      name: claims.name,
      companyId: claims.tid,
      sid: '',
      impersonator: null,
      permissions: new Set(ALL_PERMISSIONS),
      platformAdmin: false,
      coreActor,
    };
    this.cls.set('userId', claims.sub);
    this.cls.set('actorLabel', `${claims.name} (console CREAPP)`.slice(0, 100));
    this.cls.set('permissions', ALL_PERMISSIONS);
    this.cls.set('companyId', claims.tid);
    this.cls.set('platformAdmin', false);
    this.cls.set('coreActor', coreActor);
    return true;
  }
}
