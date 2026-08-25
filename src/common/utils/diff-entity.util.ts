type Diff = Record<string, [unknown, unknown]>;

const DEFAULT_OMIT = ['password', 'refreshToken', 'token', 'secret'];

export function diffEntity(
  before: Record<string, unknown>,
  after: Record<string, unknown>,
  omit: string[] = [],
): Diff {
  const skip = new Set([...DEFAULT_OMIT, ...omit]);
  const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
  const diff: Diff = {};

  for (const key of keys) {
    if (skip.has(key)) continue;
    if (before[key] !== after[key]) {
      diff[key] = [before[key] ?? null, after[key] ?? null];
    }
  }

  return diff;
}

export function snapshotCreate(entity: Record<string, unknown>, omit: string[] = []): Diff {
  const skip = new Set([...DEFAULT_OMIT, ...omit]);
  return Object.fromEntries(
    Object.entries(entity)
      .filter(([k]) => !skip.has(k))
      .map(([k, v]) => [k, [null, v ?? null]]),
  );
}

export function snapshotDelete(entity: Record<string, unknown>, omit: string[] = []): Diff {
  const skip = new Set([...DEFAULT_OMIT, ...omit]);
  return Object.fromEntries(
    Object.entries(entity)
      .filter(([k]) => !skip.has(k))
      .map(([k, v]) => [k, [v ?? null, null]]),
  );
}
