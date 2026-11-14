import { SetMetadata } from '@nestjs/common';
import type { Permission } from '../permissions';
import type { CompanyEntity } from './access.service';

export const PERMISSIONS_KEY = 'permissions';
/** The signed-in person must hold every listed permission (in their company). */
export const RequirePermissions = (...permissions: Permission[]) =>
  SetMetadata(PERMISSIONS_KEY, permissions);

export const ANY_PERMISSIONS_KEY = 'anyPermissions';
/** The signed-in person must hold at least one of the listed permissions. */
export const RequireAnyPermission = (...permissions: Permission[]) =>
  SetMetadata(ANY_PERMISSIONS_KEY, permissions);

export const PLATFORM_ADMIN_KEY = 'platformAdmin';
/**
 * What every company shares (natures, contract types, the permission labels…): reserved to a
 * Diffusion super-administrator (profile SUPER_ADMIN), on top of the route's permissions.
 */
export const PlatformAdmin = () => SetMetadata(PLATFORM_ADMIN_KEY, true);

export const APP_ADMIN_KEY = 'appAdmin';
/**
 * Routes the core's console calls (app-admin API): only a core-signed app-admin token (Bearer)
 * is accepted there (AppAdminGuard), never a person's access token.
 */
export const AppAdmin = () => SetMetadata(APP_ADMIN_KEY, true);

export const SAME_COMPANY_KEY = 'sameCompany';

/** Where the guard finds the id of the resource the request targets. */
export type CompanySource =
  | { entity: CompanyEntity; param: string }
  | { entity: CompanyEntity; body: string };

/**
 * Data isolation: the targeted resources must belong to the person's company (403 otherwise). A
 * source absent from the request, or a resource with no company yet (a sortant draft not attached
 * to a dossier), passes: the service answers 400/404 or applies its own rule.
 */
export const SameCompany = (...sources: CompanySource[]) =>
  SetMetadata(SAME_COMPANY_KEY, sources);

/** The resource is the route's `:param` (default `:id`). */
export const fromParam = (
  entity: CompanyEntity,
  param = 'id',
): CompanySource => ({ entity, param });

/** The resource is referenced by a body field (creation, re-attachment). */
export const fromBody = (
  entity: CompanyEntity,
  body: string,
): CompanySource => ({
  entity,
  body,
});
