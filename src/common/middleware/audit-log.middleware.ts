// audit-log.middleware.ts
import { Injectable, NestMiddleware, Logger } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';
import { randomUUID } from 'crypto';
import { AuditLogService } from 'src/audit/audit.service';
import type { Prisma } from 'generated/prisma/client';
// fast-redact ships no type declarations — pin down the shape we actually
// use instead of letting the import (and everything derived from it) decay
// to `any`.
import fastRedactUntyped from 'fast-redact';

type Redactor = (value: unknown) => unknown;
const fastRedact = fastRedactUntyped as (options: {
  paths: string[];
}) => Redactor;

const redact = fastRedact({
  paths: ['password', 'secret', 'token', 'authorization'],
});

const AUDITED_METHODS = new Set(['POST', 'PATCH', 'PUT', 'DELETE']);

type RequestWithUser = Request & { user?: { sub?: string; id?: string } };

@Injectable()
export class AuditLogMiddleware implements NestMiddleware {
  private readonly logger = new Logger(AuditLogMiddleware.name);

  constructor(private readonly audit: AuditLogService) {}

  use(req: Request, res: Response, next: NextFunction) {
    if (!AUDITED_METHODS.has(req.method)) return next();

    const requestId = (req.headers['x-request-id'] as string) ?? randomUUID();
    res.setHeader('x-request-id', requestId);

    let responseBody: unknown;
    const originalJson = res.json.bind(res) as (body?: unknown) => Response;
    res.json = ((body: unknown) => {
      responseBody = body;
      return originalJson(body);
    }) as typeof res.json;

    res.on('finish', () => {
      const user = (req as RequestWithUser).user;
      const responseId =
        responseBody && typeof responseBody === 'object'
          ? (responseBody as { id?: string }).id
          : undefined;

      void this.audit.record({
        action: deriveAction(req).slice(0, 50),
        entityType: req.originalUrl
          .split('?')[0]
          .split('/')
          .filter(Boolean)[0]
          ?.slice(0, 50),
        userId: user?.sub ?? user?.id ?? undefined,
        entityId: (req.params?.id as string | undefined) ?? responseId,
        metadata: {
          request: isPlainObject(req.body)
            ? (redact(req.body) as Prisma.JsonValue)
            : undefined,
          response: isPlainObject(responseBody)
            ? (redact(responseBody) as Prisma.JsonValue)
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

  const proto: unknown = Object.getPrototypeOf(value);
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
