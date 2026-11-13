import { ForbiddenException } from '@nestjs/common';
import { isInScope, SiteScopeList } from './rbac.service';

/**
 * For unit tests mocking RbacService: the scope checks
 * (assertManagesSite, explainOutOfScope) behaving like the real ones on top
 * of the mocked `managedSites`, with a plain refusal message.
 */
export function withScopeChecks<T extends { managedSites: jest.Mock }>(
  rbac: T,
) {
  const explainOutOfScope = jest.fn(
    (scope: SiteScopeList, siteId: string | null) => {
      if (!isInScope(scope, siteId)) {
        return Promise.reject(new ForbiddenException('Refusé'));
      }
      return Promise.resolve();
    },
  );
  const assertManagesSite = jest.fn(
    async (userId: string, permission: string, siteId: string | null) => {
      const scope = (await rbac.managedSites(
        userId,
        permission,
      )) as SiteScopeList;
      await explainOutOfScope(scope, siteId);
      return scope;
    },
  );
  return Object.assign(rbac, { explainOutOfScope, assertManagesSite });
}
