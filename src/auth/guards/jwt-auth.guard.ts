import {
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthGuard } from '@nestjs/passport';
import { ALLOW_PENDING_PASSWORD_CHANGE } from '../decorators/allow-pending-password-change.decorator';
import { JwtPayload } from '../types/jwt-payload.type';

@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {
  constructor(private readonly reflector: Reflector) {
    super();
  }

  handleRequest<TUser = JwtPayload>(
    err: unknown,
    user: unknown,
    info: unknown,
    context: ExecutionContext,
    status?: unknown,
  ): TUser {
    const account = super.handleRequest<JwtPayload>(
      err,
      user,
      info,
      context,
      status,
    );
    if (
      account.mustChangePassword &&
      !this.reflector.getAllAndOverride<boolean>(
        ALLOW_PENDING_PASSWORD_CHANGE,
        [context.getHandler(), context.getClass()],
      )
    ) {
      throw new ForbiddenException(
        'Vous devez changer votre mot de passe avant de continuer',
      );
    }
    return account as TUser;
  }
}
