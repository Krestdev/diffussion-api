import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Request } from 'express';
import { JwtPayload } from '../types/jwt-payload.type';
import { PERMISSION_METADATA_KEY, PermissionCode } from './rbac.constants';
import { RbacService } from './rbac.service';

// Runs after JwtAuthGuard (req.user must already be set). No-op if the
// route/controller carries no @RequirePermission metadata.
@Injectable()
export class PermissionGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly rbacService: RbacService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const required = this.reflector.getAllAndOverride<
      PermissionCode | undefined
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

    const granted = await this.rbacService.hasPermission(user.sub, required);
    if (!granted) {
      throw new ForbiddenException(`Missing permission: ${required}`);
    }
    return true;
  }
}
