import { BadRequestException, HttpException, HttpStatus } from '@nestjs/common';
import { Prisma } from '../../generated/prisma/client';
import type { ToolLink } from './mcp-tool';

type ActionStateLike = {
  action: string;
  enabled: boolean;
  reason?: string;
  params?: Record<string, string>;
};

const isActionStates = (value: unknown): value is ActionStateLike[] =>
  Array.isArray(value) &&
  value.every(
    (s) =>
      typeof s === 'object' && s !== null && 'action' in s && 'enabled' in s,
  );

type DiffusionPage = {
  data: unknown[];
  total: number;
  skip?: number;
  take?: number;
};

/** Diffusion's lists: `{ data, total, skip, take }` (sometimes with `metrics`). */
const isPage = (value: unknown): value is DiffusionPage =>
  typeof value === 'object' &&
  value !== null &&
  Array.isArray((value as { data?: unknown }).data) &&
  typeof (value as { total?: unknown }).total === 'number';

/**
 * Shapes an API answer for the model, with fewer tokens and nothing lost that matters:
 * - pages become `{ total, page, returned, items }` (what the AI gateway reads), other page
 *   keys (`metrics`…) kept;
 * - decimals as strings, dates as ISO strings (as the REST API sends them);
 * - no null, undefined or empty values;
 * - `actions` (ActionState[]) become `available` (and, on a single record, `unavailable` with
 *   the reason code, so the model can say why an action is blocked);
 * - records get the `link` of their UI page.
 */
export function shape(value: unknown, link?: ToolLink): unknown {
  if (isPage(value)) {
    const { data, total, skip, take, ...rest } = value;
    const items = data.map((item) => clean(item, 0, link, true));
    const extra = clean(rest, 1, undefined, true) as
      Record<string, unknown> | undefined;
    return {
      total,
      page: take ? Math.floor((skip ?? 0) / take) + 1 : 1,
      returned: items.length,
      items,
      ...(extra ?? {}),
    };
  }
  if (Array.isArray(value)) return value.map((v) => clean(v, 0, link, true));
  return clean(value, 0, link, false);
}

/** The UI page of one record, if the tool has one. */
export function linkOf(
  link: ToolLink | undefined,
  record: Record<string, unknown>,
): string | undefined {
  if (!link || typeof record.id !== 'string') return undefined;
  return typeof link === 'function'
    ? link(record)
    : link.replace('{id}', record.id);
}

function clean(
  value: unknown,
  depth: number,
  link: ToolLink | undefined,
  row: boolean,
): unknown {
  if (value === null || value === undefined) return undefined;
  if (value instanceof Prisma.Decimal) return value.toString();
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'bigint') return value.toString();
  if (Array.isArray(value)) {
    const items = value
      .map((v) => clean(v, depth + 1, undefined, row))
      .filter((v) => v !== undefined);
    return items.length ? items : undefined;
  }
  if (typeof value !== 'object') return value;

  const source = value as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const [key, field] of Object.entries(source)) {
    if (key === 'actions' && isActionStates(field)) {
      const available = field.filter((s) => s.enabled).map((s) => s.action);
      if (available.length) out.available = available;
      if (!row) {
        const unavailable = field
          .filter((s) => !s.enabled)
          .map((s) =>
            clean(
              { action: s.action, reason: s.reason, params: s.params },
              depth + 1,
              undefined,
              row,
            ),
          );
        if (unavailable.length) out.unavailable = unavailable;
      }
      continue;
    }
    const cleaned = clean(field, depth + 1, undefined, row);
    if (cleaned !== undefined) out[key] = cleaned;
  }
  // Only the record itself gets a link (depth 0), not the people or lines inside it.
  if (depth === 0) {
    const page = linkOf(link, source);
    if (page) out.link = page;
  }
  return Object.keys(out).length ? out : undefined;
}

/** How an error goes back to the model: `{ error: CODE, params, message }`. */
export type ErrorBody = {
  statusCode: number;
  code: string;
  params?: Record<string, unknown>;
  message?: string | string[];
};

const CODE_BY_STATUS: Record<number, string> = {
  [HttpStatus.BAD_REQUEST]: 'INVALID_REQUEST',
  [HttpStatus.UNAUTHORIZED]: 'UNAUTHENTICATED',
  [HttpStatus.FORBIDDEN]: 'FORBIDDEN',
  [HttpStatus.NOT_FOUND]: 'NOT_FOUND',
  [HttpStatus.CONFLICT]: 'CONFLICT',
  [HttpStatus.UNPROCESSABLE_ENTITY]: 'INVALID_REQUEST',
  [HttpStatus.TOO_MANY_REQUESTS]: 'TOO_MANY_REQUESTS',
  [HttpStatus.SERVICE_UNAVAILABLE]: 'UNAVAILABLE',
};

/**
 * The same reading of an error as AllExceptionsFilter (the REST answer): the exception's own
 * `code` and `params`, else a code from its status; Prisma constraint errors as client errors.
 */
export function errorBody(error: unknown): ErrorBody {
  if (error instanceof HttpException) {
    const statusCode = error.getStatus();
    const response = error.getResponse();
    const body =
      typeof response === 'object' && response !== null
        ? (response as Record<string, unknown>)
        : {};
    const message =
      typeof response === 'string'
        ? response
        : (body.message as string | string[] | undefined);
    const code =
      typeof body.code === 'string'
        ? body.code
        : error instanceof BadRequestException && Array.isArray(message)
          ? 'VALIDATION_FAILED'
          : (CODE_BY_STATUS[statusCode] ??
            (statusCode >= 500 ? 'INTERNAL_ERROR' : 'INVALID_REQUEST'));
    const params =
      body.params && typeof body.params === 'object'
        ? (body.params as Record<string, unknown>)
        : undefined;
    return {
      statusCode,
      code,
      params,
      message: statusCode >= 500 ? undefined : message,
    };
  }
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    if (error.code === 'P2002') {
      return { statusCode: 409, code: 'UNIQUE_CONSTRAINT' };
    }
    if (error.code === 'P2003') {
      return { statusCode: 400, code: 'INVALID_REFERENCE' };
    }
    if (error.code === 'P2025') return { statusCode: 404, code: 'NOT_FOUND' };
  }
  return { statusCode: 500, code: 'INTERNAL_ERROR' };
}
