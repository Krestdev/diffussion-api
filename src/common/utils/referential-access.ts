import { BadRequestException } from '@nestjs/common';
import { Prisma, UserStatus } from '../../../generated/prisma/client';

type Db = Prisma.TransactionClient;

/**
 * Projects and contracts carry a list of users allowed to open them. A
 * project nobody is listed on is open to everyone; its responsible always
 * may. Platform administrators (global ADMIN_MANAGE_REFERENTIALS) skip the
 * filter altogether — callers leave it out for them.
 */
export function visibleProjectWhere(userId: string): Prisma.ProjectWhereInput {
  return {
    OR: [
      { accesses: { none: {} } },
      { responsibleId: userId },
      { accesses: { some: { userId } } },
    ],
  };
}

/** Same rule as visibleProjectWhere, for a contract. */
export function visibleContractWhere(
  userId: string,
): Prisma.ContractWhereInput {
  return {
    OR: [
      { accesses: { none: {} } },
      { responsibleId: userId },
      { accesses: { some: { userId } } },
    ],
  };
}

/** Every id must be an active user (deduplicated on the way). */
export async function assertActiveUsers(db: Db, userIds: string[]) {
  const unique = [...new Set(userIds)];
  if (unique.length === 0) return unique;
  const users = await db.user.findMany({
    where: { id: { in: unique } },
    select: { id: true, status: true },
  });
  const active = new Set(
    users
      .filter((user) => user.status === UserStatus.ACTIVE)
      .map((user) => user.id),
  );
  const refused = unique.filter((id) => !active.has(id));
  if (refused.length > 0) {
    throw new BadRequestException(
      `Unknown or inactive user(s): ${refused.join(', ')}`,
    );
  }
  return unique;
}
