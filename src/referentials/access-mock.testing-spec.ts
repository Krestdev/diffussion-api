import { ForbiddenException } from '@nestjs/common';
import { ALL_PERMISSIONS } from '../auth/permissions';

/** Who the mocked AccessService says the caller is. */
export interface AccessState {
  companyId: string | null;
  permissions: string[];
  platformAdmin: boolean;
}

/**
 * For unit tests: an AccessService whose answers follow `state` (by default a person of company
 * s-1 holding every permission), with the same rules as the real one — a person acts in their own
 * company only; what every company shares needs a super-administrator.
 */
export function accessMock(initial: Partial<AccessState> = {}) {
  const state: AccessState = {
    companyId: 's-1',
    permissions: [...ALL_PERMISSIONS],
    platformAdmin: false,
    ...initial,
  };
  const has = (p: string) => state.permissions.includes(p);
  return {
    state,
    permissionsOf: jest.fn(() => Promise.resolve([...state.permissions])),
    has: jest.fn((_u: string, p: string) => Promise.resolve(has(p))),
    hasAny: jest.fn((_u: string, ...ps: string[]) =>
      Promise.resolve(ps.some(has)),
    ),
    companyOf: jest.fn(() => Promise.resolve(state.companyId)),
    isPlatformAdmin: jest.fn(() => Promise.resolve(state.platformAdmin)),
    managesCommon: jest.fn((_u: string, p: string) =>
      Promise.resolve(state.platformAdmin && has(p)),
    ),
    scope: jest.fn((_u: string, p: string) =>
      Promise.resolve(has(p) && state.companyId ? [state.companyId] : []),
    ),
    hasAtCompany: jest.fn((_u: string, p: string, c: string | null) =>
      Promise.resolve(!!c && c === state.companyId && has(p)),
    ),
    worksAtCompany: jest.fn((_u: string, c: string) =>
      Promise.resolve(c === state.companyId),
    ),
    companyFilter: jest.fn(
      (_u: string, p: string, toWhere: (c: { in: string[] }) => unknown) =>
        Promise.resolve(
          toWhere({
            in: has(p) && state.companyId ? [state.companyId] : [],
          }),
        ),
    ),
    assertManages: jest.fn(
      (_u: string, p: string, c: string | null): Promise<void> => {
        if (!has(p)) return Promise.reject(new ForbiddenException(p));
        if (c === null) {
          return state.platformAdmin
            ? Promise.resolve()
            : Promise.reject(new ForbiddenException('common'));
        }
        return c === state.companyId
          ? Promise.resolve()
          : Promise.reject(new ForbiddenException('another company'));
      },
    ),
    resolveCompanyId: jest.fn(),
    assertSameCompany: jest.fn(() => Promise.resolve()),
  };
}

export type AccessMock = ReturnType<typeof accessMock>;
