import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { Observable, map } from 'rxjs';
import { groupLivrableVersions } from '../common/utils/livrable-history';

function hasLivrables(
  value: unknown,
): value is { livrables: Parameters<typeof groupLivrableVersions>[0] } {
  return (
    typeof value === 'object' &&
    value !== null &&
    Array.isArray((value as { livrables?: unknown }).livrables)
  );
}

function groupInstruction(value: unknown): unknown {
  return hasLivrables(value)
    ? { ...value, livrables: groupLivrableVersions(value.livrables) }
    : value;
}

/**
 * Applies groupLivrableVersions to the instruction(s) a route returns —
 * one instruction, an array, or a page `{ data: [...] }`. The services keep
 * working on the flat list of versions.
 */
@Injectable()
export class LivrableHistoryInterceptor implements NestInterceptor {
  intercept(
    _context: ExecutionContext,
    next: CallHandler,
  ): Observable<unknown> {
    return next.handle().pipe(
      map((body: unknown) => {
        if (Array.isArray(body)) return body.map(groupInstruction);
        const page = body as { data?: unknown } | null;
        if (page && Array.isArray(page.data)) {
          return { ...page, data: page.data.map(groupInstruction) };
        }
        return groupInstruction(body);
      }),
    );
  }
}
