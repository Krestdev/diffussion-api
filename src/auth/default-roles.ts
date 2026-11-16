import { Prisma } from '../generated/prisma/client';
import { PERMISSION_LABELS } from './permission-labels';
import {
  ADMIN_ROLE_CODE,
  ALL_PERMISSIONS,
  DEFAULT_ROLES,
  defaultRoleName,
  roleCodeOf,
} from './permissions';

type Tx = Prisma.TransactionClient;

/**
 * The permission table mirrors the catalogue (roles point at its rows): every code of
 * src/auth/permissions.ts gets its row, described by its French label. Rows of withdrawn codes are
 * left to the migrations that withdrew them.
 */
export async function syncPermissionCatalog(db: Tx): Promise<void> {
  const existing = await db.permission.findMany({ select: { code: true } });
  const known = new Set(existing.map((p) => p.code));
  const missing = ALL_PERMISSIONS.filter((code) => !known.has(code));
  if (missing.length === 0) return;
  await db.permission.createMany({
    data: missing.map((code) => ({
      code,
      description: PERMISSION_LABELS[code]?.fr ?? code,
    })),
    skipDuplicates: true,
  });
}

/** Rows of the permission table for these codes (created when missing). */
export async function permissionIds(
  db: Tx,
  codes: readonly string[],
): Promise<Map<string, string>> {
  if (codes.length === 0) return new Map();
  let rows = await db.permission.findMany({
    where: { code: { in: [...codes] } },
    select: { id: true, code: true },
  });
  if (rows.length < new Set(codes).size) {
    await syncPermissionCatalog(db);
    rows = await db.permission.findMany({
      where: { code: { in: [...codes] } },
      select: { id: true, code: true },
    });
  }
  return new Map(rows.map((p) => [p.code, p.id]));
}

/**
 * A company's default roles (ADMIN, holding every permission, and Diffusion's default company
 * roles), each created once — a role the company already has (same code or same name) is kept as
 * it is. `adminIds` (its administrators) hold ADMIN.
 */
export async function createDefaultRoles(
  tx: Tx,
  companyId: string,
  {
    adminIds = [],
    language = 'fr',
  }: { adminIds?: string[]; language?: string } = {},
): Promise<void> {
  const ids = await permissionIds(tx, ALL_PERMISSIONS);
  for (const role of DEFAULT_ROLES) {
    const code = roleCodeOf(role.key);
    const name = defaultRoleName(role, language);
    const taken = await tx.role.findFirst({
      where: { companyId, OR: [{ code }, { name }] },
      select: { id: true },
    });
    if (taken) continue;
    await tx.role.create({
      data: {
        companyId,
        code,
        name,
        description: role.description,
        isSystem: true,
        rolePermissions: {
          create: role.permissions
            .filter((p) => ids.has(p))
            .map((p) => ({ permissionId: ids.get(p)! })),
        },
      },
      select: { id: true },
    });
  }
  await giveAdminRole(tx, companyId, adminIds);
}

/** The company's ADMIN role, if it has one. */
export async function adminRoleId(
  tx: Tx,
  companyId: string,
): Promise<string | null> {
  const role = await tx.role.findFirst({
    where: { companyId, code: ADMIN_ROLE_CODE, isSystem: true },
    select: { id: true },
  });
  return role?.id ?? null;
}

/** These people (the company's administrators) hold its ADMIN role. */
export async function giveAdminRole(
  tx: Tx,
  companyId: string,
  userIds: string[],
): Promise<string[]> {
  if (userIds.length === 0) return [];
  const roleId = await adminRoleId(tx, companyId);
  if (!roleId) return [];
  const without = await tx.user.findMany({
    where: {
      id: { in: userIds },
      companyId,
      userRoles: { none: { roleId } },
    },
    select: { id: true },
  });
  if (without.length === 0) return [];
  await tx.userRole.createMany({
    data: without.map((user) => ({ userId: user.id, roleId })),
    skipDuplicates: true,
  });
  return without.map((user) => user.id);
}
