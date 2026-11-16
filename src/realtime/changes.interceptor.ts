import {
  Injectable,
  type CallHandler,
  type ExecutionContext,
  type NestInterceptor,
} from '@nestjs/common';
import type { Request } from 'express';
import { tap, type Observable } from 'rxjs';
import type { AuthUser } from '../auth/types/auth-user.type';
import { changeOf } from './changes';
import { RealtimeGateway } from './realtime.gateway';

/** The browser tab a request comes from (the UI sends it; the tab skips its own change). */
export const CLIENT_ID_HEADER = 'x-client-id';

/**
 * After every successful modification (POST, PUT, PATCH, DELETE), tells the company's open
 * tabs what changed so they refresh it (as EXPENZO's). A failed call changed nothing and sends
 * nothing; a call without a signed-in person (health, public routes) neither.
 */
@Injectable()
export class ChangesInterceptor implements NestInterceptor {
  constructor(private readonly realtime: RealtimeGateway) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== 'http') return next.handle();
    const request = context
      .switchToHttp()
      .getRequest<Request & { user?: AuthUser }>();
    if (request.method === 'GET' || request.method === 'HEAD') {
      return next.handle();
    }
    return next.handle().pipe(
      tap(() => {
        // Set by CoreAuthGuard (or AppAdminGuard), which ran before.
        const user = request.user;
        if (!user?.sub) return;
        const header = request.headers[CLIENT_ID_HEADER];
        const clientId =
          typeof header === 'string' ? header.slice(0, 64) : undefined;
        const found = changeOf(
          context.getClass(),
          context.getHandler() as (...args: never[]) => unknown,
          request.params,
          { by: user.sub, clientId },
        );
        if (found) {
          this.realtime.publish(user.companyId, found.change, found.personal);
        }
      }),
    );
  }
}
