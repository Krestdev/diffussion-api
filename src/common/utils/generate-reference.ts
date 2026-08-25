import { randomInt } from 'node:crypto';

/**
 * Generates a short human-readable reference like "D-728391" (RG-DOS-002,
 * RG-COU internal registration number, ...). Not guaranteed globally unique
 * on its own — callers should retry on a unique-constraint violation
 * (see `createWithUniqueReference`).
 */
export function generateReference(prefix: string): string {
  return `${prefix}-${randomInt(100000, 999999)}`;
}

/**
 * Runs `attempt(reference)` with a freshly generated reference, retrying on
 * a Prisma unique-constraint violation (P2002) up to `maxAttempts` times.
 * Used for system-generated, unique, human-readable numbers where a DB
 * sequence would be overkill.
 */
export async function createWithUniqueReference<T>(
  prefix: string,
  attempt: (reference: string) => Promise<T>,
  maxAttempts = 5,
): Promise<T> {
  let lastError: unknown;
  for (let i = 0; i < maxAttempts; i++) {
    try {
      return await attempt(generateReference(prefix));
    } catch (error) {
      lastError = error;
      const code = (error as { code?: string })?.code;
      if (code !== 'P2002') {
        throw error;
      }
    }
  }
  throw lastError;
}
