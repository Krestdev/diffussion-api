import { ClsServiceManager } from 'nestjs-cls';
import type { AppClsStore } from '../../cls.store';
import type { Permission } from '../permissions';
import { forbidden } from './permissions.guard';

/** The signed-in person's codes (set by CoreAuthGuard / AppAdminGuard), empty outside a request. */
function held(): readonly string[] {
  const cls = ClsServiceManager.getClsService<AppClsStore>();
  if (!cls.isActive()) return [];
  return cls.get('permissions') ?? [];
}

/** Whether the signed-in person holds a permission. */
export function can(permission: Permission): boolean {
  return held().includes(permission);
}

/** Whether the signed-in person holds any of these permissions. */
export function canAny(...permissions: Permission[]): boolean {
  return permissions.some(can);
}

/** Refuses with 403 FORBIDDEN (naming the code) unless the person holds it. */
export function assertCan(permission: Permission): void {
  if (!can(permission)) throw forbidden(permission);
}

/**
 * One route that edits several groups of fields, each needing its own code: every group the body
 * changes (a field present) needs its code. Pair it with @RequireAnyPermission of every code, so
 * holders of any of them reach the route.
 */
export function assertFieldPermissions(
  body: object,
  rules: readonly { fields: readonly string[]; permission: Permission }[],
): void {
  const values = body as Record<string, unknown>;
  for (const rule of rules) {
    if (rule.fields.some((field) => values[field] !== undefined)) {
      assertCan(rule.permission);
    }
  }
}
