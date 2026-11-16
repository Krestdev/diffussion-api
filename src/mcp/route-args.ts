import { ParseUUIDPipe, type Type } from '@nestjs/common';
import { ROUTE_ARGS_METADATA } from '@nestjs/common/constants';
import { CurrentUser } from '../auth/decorators/current-user.decorator';

/** Nest's RouteParamtypes (the key prefix of ROUTE_ARGS_METADATA entries). */
const REQUEST = 0;
const BODY = 3;
const QUERY = 4;
const PARAM = 5;

type RawArg = { index: number; data?: string; pipes?: unknown[] };

/** What a REST handler takes, argument by argument, read from its decorators. */
export type RouteArg =
  | { kind: 'param'; index: number; name: string; uuid: boolean }
  | { kind: 'body'; index: number; field?: string; type?: Type<object> }
  | { kind: 'query'; index: number; field?: string; type?: Type<object> }
  /** @CurrentUser(): the signed-in person (AuthUser). */
  | { kind: 'user'; index: number }
  /** @Req(): the request (CoreAuthGuard's `user` and `core` on it). */
  | { kind: 'request'; index: number }
  /** @Res(), @UploadedFile(s)(), @Headers()…: nothing a tool can give. */
  | { kind: 'other'; index: number; what: string };

/** The key prefix @CurrentUser() gets (createParamDecorator makes it per decorator). */
const CURRENT_USER = (() => {
  class Probe {
    handler(@CurrentUser() _user: unknown) {
      return _user;
    }
  }
  const keys = Object.keys(
    (Reflect.getMetadata(ROUTE_ARGS_METADATA, Probe, 'handler') ??
      {}) as object,
  );
  return keys[0]?.split(':')[0];
})();

const OTHER: Record<number, string> = {
  1: '@Res()',
  2: '@Next()',
  6: '@Headers()',
  7: '@Session()',
  8: '@UploadedFile()',
  9: '@UploadedFiles()',
  10: '@HostParam()',
  11: '@Ip()',
  12: '@RawBody()',
};

/** The handler's arguments, in order. */
export function routeArgs(type: Type<unknown>, method: string): RouteArg[] {
  const raw = (Reflect.getMetadata(ROUTE_ARGS_METADATA, type, method) ??
    {}) as Record<string, RawArg>;
  const paramTypes = (Reflect.getMetadata(
    'design:paramtypes',
    type.prototype as object,
    method,
  ) ?? []) as unknown[];
  const dtoAt = (index: number): Type<object> | undefined => {
    const candidate = paramTypes[index];
    return typeof candidate === 'function' &&
      candidate !== Object &&
      candidate !== String &&
      candidate !== Number &&
      candidate !== Boolean &&
      candidate !== Array
      ? (candidate as Type<object>)
      : undefined;
  };

  const args: RouteArg[] = [];
  for (const [key, arg] of Object.entries(raw)) {
    const prefix = key.split(':')[0];
    const { index } = arg;
    if (prefix === CURRENT_USER) {
      args.push({ kind: 'user', index });
      continue;
    }
    const kind = Number(prefix);
    if (kind === PARAM && arg.data) {
      const uuid = !!arg.pipes?.some(
        (pipe) => pipe === ParseUUIDPipe || pipe instanceof ParseUUIDPipe,
      );
      args.push({ kind: 'param', index, name: arg.data, uuid });
    } else if (kind === BODY) {
      args.push({
        kind: 'body',
        index,
        field: arg.data,
        type: arg.data ? undefined : dtoAt(index),
      });
    } else if (kind === QUERY) {
      args.push({
        kind: 'query',
        index,
        field: arg.data,
        type: arg.data ? undefined : dtoAt(index),
      });
    } else if (kind === REQUEST) {
      args.push({ kind: 'request', index });
    } else {
      args.push({
        kind: 'other',
        index,
        what: OTHER[kind] ?? `custom decorator ${prefix}`,
      });
    }
  }
  return args.sort((a, b) => a.index - b.index);
}
