import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { ClsService } from 'nestjs-cls';
import { ActivityService } from './activity.service';
import { AppClsStore } from '../cls.store';

/**
 * Global interceptor that creates a **root activity log** for every incoming
 * HTTP request. The root log ID is stored in CLS so that any subsequent
 * `activity.record()` calls within the same request become children.
 */
@Injectable()
export class ActivityInterceptor implements NestInterceptor {
  constructor(
    private readonly activity: ActivityService,
    private readonly cls: ClsService<AppClsStore>,
  ) {}

  async intercept(
    context: ExecutionContext,
    next: CallHandler,
  ): Promise<Observable<any>> {
    const req = context.switchToHttp().getRequest();
    const method: string = req.method;
    const url: string = req.originalUrl;

    const userId = this.cls.get('userId');

    // We generally don't want to spam the database with a root log for every single GET request.
    // By also checking for `userId`, we only log authenticated user actions 
    // (which automatically ignores public routes like /auth/register and /auth/login).
    if (method !== 'GET' && userId) {
      await this.activity.recordRoot({
        action: `${method} ${url}`,
        source: 'USER',
        message: `Request: ${method} ${url}`,
      });
    }

    return next.handle();
  }
}
