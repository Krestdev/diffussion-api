import { SetMetadata } from '@nestjs/common';

export const SITE_SCOPE_METADATA_KEY = 'rbac:site-scope';

/** Resources that resolve to the site owning them (see RbacService.resolveSiteId). */
export type SiteEntity =
  | 'site'
  | 'dossier'
  | 'courrier'
  | 'instruction'
  | 'livrable'
  | 'analysisSheet'
  | 'analysisItem';

/** Where the guard finds the id of the resource the request targets. */
export type SiteSource =
  { entity: SiteEntity; param: string } | { entity: SiteEntity; body: string };

/**
 * Checks the route's @RequirePermission at the site of the targeted resource
 * instead of "at any site". Several sources are all checked (e.g. a dossier
 * moved to another site needs the permission at both). A source that is
 * absent from the request, or a resource with no site yet (a sortant draft
 * not attached to a dossier), falls back to the "at any site" check.
 */
export const SiteScope = (...sources: SiteSource[]) =>
  SetMetadata(SITE_SCOPE_METADATA_KEY, sources);

/** The resource is the route's `:param` (default `:id`). */
export const fromParam = (entity: SiteEntity, param = 'id'): SiteSource => ({
  entity,
  param,
});

/** The resource is referenced by a body field (creation, re-attachment). */
export const fromBody = (entity: SiteEntity, body: string): SiteSource => ({
  entity,
  body,
});
