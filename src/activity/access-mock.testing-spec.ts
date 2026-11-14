import { ForbiddenException } from '@nestjs/common';

/**
 * For unit tests: an AccessService stand-in behaving like the real one for one person — of
 * `companyId`, holding `permissions`, a super-administrator or not. Every method is a jest.fn,
 * so a test can still override one (mockResolvedValue).
 */
export function accessMock(
  options: {
    companyId?: string | null;
    permissions?: readonly string[];
    platformAdmin?: boolean;
  } = {},
) {
  const state = {
    companyId: options.companyId === undefined ? 's-1' : options.companyId,
    permissions: [...(options.permissions ?? [])],
    platformAdmin: options.platformAdmin ?? false,
  };
  const has = jest.fn((_user: string, permission: string) =>
    Promise.resolve(state.permissions.includes(permission)),
  );
  const access = {
    state,
    permissionsOf: jest.fn(() => Promise.resolve([...state.permissions])),
    has,
    hasAny: jest.fn((_user: string, ...permissions: string[]) =>
      Promise.resolve(permissions.some((p) => state.permissions.includes(p))),
    ),
    companyOf: jest.fn(() => Promise.resolve(state.companyId)),
    isPlatformAdmin: jest.fn(() => Promise.resolve(state.platformAdmin)),
    managesCommon: jest.fn((_user: string, permission: string) =>
      Promise.resolve(
        state.platformAdmin && state.permissions.includes(permission),
      ),
    ),
    scope: jest.fn((_user: string, permission: string) =>
      Promise.resolve(
        state.permissions.includes(permission) && state.companyId
          ? [state.companyId]
          : [],
      ),
    ),
    hasAtCompany: jest.fn(
      (_user: string, permission: string, companyId: string | null) =>
        Promise.resolve(
          !!companyId &&
            companyId === state.companyId &&
            state.permissions.includes(permission),
        ),
    ),
    worksAtCompany: jest.fn((_user: string, companyId: string) =>
      Promise.resolve(companyId === state.companyId),
    ),
    companyFilter: jest.fn(
      (
        _user: string,
        permission: string,
        toWhere: (companyId: { in: string[] }) => unknown,
      ) =>
        Promise.resolve(
          toWhere({
            in:
              state.permissions.includes(permission) && state.companyId
                ? [state.companyId]
                : [],
          }),
        ),
    ),
    assertManages: jest.fn(
      (
        _user: string,
        permission: string,
        companyId: string | null,
      ): Promise<void> => {
        if (!state.permissions.includes(permission)) {
          return Promise.reject(new ForbiddenException('Refusé'));
        }
        if (companyId === null) {
          return state.platformAdmin
            ? Promise.resolve()
            : Promise.reject(new ForbiddenException('Refusé'));
        }
        return companyId === state.companyId
          ? Promise.resolve()
          : Promise.reject(new ForbiddenException('Refusé'));
      },
    ),
    resolveCompanyId: jest.fn(() =>
      Promise.resolve<string | null | undefined>(state.companyId),
    ),
    assertSameCompany: jest.fn(() => Promise.resolve()),
  };
  return access;
}

export type AccessMock = ReturnType<typeof accessMock>;
