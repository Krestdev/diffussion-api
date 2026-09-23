import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpException,
  HttpStatus,
  Injectable,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { ClsService } from 'nestjs-cls';
import { AppClsStore } from '../../cls.store';
import { DbLogger } from '../../logging/db.logger';
import { Prisma } from '../../../generated/prisma/client';

// Prisma reports the offending columns differently depending on the engine:
// `meta.target` (classic) or nested under `meta.driverAdapterError` (driver
// adapters, which this app uses). Best effort — the message stays generic
// when neither is present.
function uniqueFields(error: Prisma.PrismaClientKnownRequestError): string[] {
  const meta = error.meta as
    | {
        target?: string | string[];
        driverAdapterError?: {
          cause?: { constraint?: { fields?: string[] } };
        };
      }
    | undefined;
  const target = meta?.target;
  if (Array.isArray(target)) return target;
  if (typeof target === 'string') return [target];
  return meta?.driverAdapterError?.cause?.constraint?.fields ?? [];
}

// An HttpException's payload is either a plain string or an object whose
// `message` holds the real detail (one string, or one per invalid field).
function extractMessage(exception: HttpException): string | string[] {
  const response = exception.getResponse();
  if (typeof response === 'string') return response;
  const detail = (response as { message?: string | string[] }).message;
  if (Array.isArray(detail)) return detail;
  return detail ?? exception.message;
}

// Safety net for constraint violations a service didn't check explicitly:
// they're client errors (409/400/404), not a server failure (500).
function mapPrismaError(
  error: Prisma.PrismaClientKnownRequestError,
): { status: number; message: string } | null {
  switch (error.code) {
    case 'P2002': {
      const fields = uniqueFields(error);
      return {
        status: HttpStatus.CONFLICT,
        message: fields.length
          ? `A record with this ${fields.join(', ')} already exists`
          : 'A record with the same unique value already exists',
      };
    }
    case 'P2003':
      return {
        status: HttpStatus.BAD_REQUEST,
        message:
          'Invalid reference: the related record does not exist, or this record is still referenced elsewhere',
      };
    case 'P2025':
      return { status: HttpStatus.NOT_FOUND, message: 'Record not found' };
    default:
      return null;
  }
}

@Injectable()
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  constructor(
    private readonly cls: ClsService<AppClsStore>,
    private readonly logger: DbLogger,
  ) {}

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const req = ctx.getRequest<Request>();
    const res = ctx.getResponse<Response>();

    const prismaError =
      exception instanceof Prisma.PrismaClientKnownRequestError
        ? mapPrismaError(exception)
        : null;

    const status =
      exception instanceof HttpException
        ? exception.getStatus()
        : (prismaError?.status ?? HttpStatus.INTERNAL_SERVER_ERROR);

    // ValidationPipe puts the per-field errors in the response *body*, not in
    // `message` (which is just "Bad Request Exception") — surfacing them is
    // the difference between a usable 400 and a guessing game.
    const message =
      exception instanceof HttpException
        ? extractMessage(exception)
        : (prismaError?.message ?? 'Internal server error');

    const stack = exception instanceof Error ? exception.stack : undefined;

    if (status >= 500) {
      this.logger.error(
        `${req.method} ${req.originalUrl} → ${status}: ${
          Array.isArray(message) ? message.join('; ') : message
        }`,
        stack,
        'ExceptionFilter',
      );
    } else {
      this.logger.warn(
        `${req.method} ${req.originalUrl} → ${status}: ${
          Array.isArray(message) ? message.join('; ') : message
        }`,
        'ExceptionFilter',
      );
    }

    res.status(status).json({
      statusCode: status,
      message,
      requestId: this.cls.get('requestId') ?? null,
    });
  }
}
