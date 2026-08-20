// audit-log.middleware.ts
import { Injectable, NestMiddleware, Logger } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';
import { randomUUID } from 'crypto';
import { AuditLogService } from 'src/audit/audit.service';
import fastRedact from 'fast-redact';

const redact = fastRedact({
  paths: ['password', 'secret', 'token', 'authorization'],
});

const AUDITED_METHODS = new Set(['POST', 'PATCH', 'PUT', 'DELETE']);

@Injectable()
export class AuditLogMiddleware implements NestMiddleware {
  private readonly logger = new Logger(AuditLogMiddleware.name);

  constructor(private readonly audit: AuditLogService) {}

  use(req: Request, res: Response, next: NextFunction) {
    if (!AUDITED_METHODS.has(req.method)) return next();

    const requestId = (req.headers['x-request-id'] as string) ?? randomUUID();
    res.setHeader('x-request-id', requestId);

    let responseBody: unknown;
    const originalJson = res.json.bind(res);
    res.json = (body: any) => {
      responseBody = body;
      return originalJson(body);
    };

    res.on('finish', () => {
      const user = (req as any).user;
      void this.audit.record({
        actions: deriveAction(req).slice(0, 10),
        entityType: req.originalUrl
          .split('?')[0]
          .split('/')
          .filter(Boolean)[0]
          ?.slice(0, 10),
        userId: user?.sub ?? user?.id ?? null,
        entityId: (req.params?.id ?? (responseBody as any)?.id) as string,
        metadata: {
          request: isPlainObject(req.body) ? redact(req.body) : undefined,
          response: isPlainObject(responseBody)
            ? redact(responseBody)
            : undefined,
        },
      });
    });

    next();
  }
}

function isPlainObject(value: unknown): boolean {
  if (value === null || typeof value !== 'object') return false;
  if (Array.isArray(value)) return false;

  const proto = Object.getPrototypeOf(value);
  return proto === null || proto === Object.prototype;
}

function deriveAction(req: Request): string {
  const segment =
    req.originalUrl.split('?')[0].split('/').filter(Boolean)[0] ?? 'unknown';
  const verb =
    (
      {
        POST: 'create',
        PATCH: 'update',
        PUT: 'update',
        DELETE: 'delete',
      } as Record<string, string>
    )[req.method] ?? 'action';
  return `${segment}.${verb}`;
}
