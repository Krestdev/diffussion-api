import { Prisma } from '../../../generated/prisma/client';

/**
 * A `{ gte, lt | lte }` filter from optional ISO bounds, for list endpoints'
 * `...From` / `...To` query params. A bare date ("2026-09-30") as the upper
 * bound means "through the end of that day", not midnight at its start.
 */
export function dateRange(
  from?: string,
  to?: string,
): Prisma.DateTimeFilter | undefined {
  if (!from && !to) return undefined;
  const range: Prisma.DateTimeFilter = {};
  if (from) range.gte = new Date(from);
  if (to) {
    const end = new Date(to);
    if (/^\d{4}-\d{2}-\d{2}$/.test(to)) {
      end.setUTCDate(end.getUTCDate() + 1);
      range.lt = end;
    } else {
      range.lte = end;
    }
  }
  return range;
}
