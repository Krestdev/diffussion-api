import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PermissionGuard } from './permission.guard';
import { PERMISSION_METADATA_KEY, PermissionCode } from './rbac.constants';
import { RbacService } from './rbac.service';
import { PLATFORM_ONLY_METADATA_KEY } from './require-permission.decorator';
import {
  SITE_SCOPE_METADATA_KEY,
  SiteSource,
  fromBody,
  fromParam,
} from './site-scope.decorator';

describe('PermissionGuard', () => {
  let rbac: Record<string, jest.Mock>;
  let metadata: Record<string, unknown>;
  let guard: PermissionGuard;

  const context = (request: {
    params?: Record<string, string>;
    body?: Record<string, unknown>;
  }) =>
    ({
      getHandler: () => undefined,
      getClass: () => undefined,
      switchToHttp: () => ({
        getRequest: () => ({ user: { sub: 'u-1' }, params: {}, ...request }),
      }),
    }) as unknown as ExecutionContext;

  const route = (permission: PermissionCode, ...sources: SiteSource[]) => {
    metadata[PERMISSION_METADATA_KEY] = permission;
    if (sources.length) metadata[SITE_SCOPE_METADATA_KEY] = sources;
  };

  beforeEach(() => {
    metadata = {};
    rbac = {
      hasPermission: jest.fn().mockResolvedValue(true),
      hasPermissionAtSite: jest.fn(),
      resolveSiteId: jest.fn(),
      hasGlobalPermission: jest.fn(),
    };
    const reflector = {
      getAllAndOverride: (key: string) => metadata[key],
    } as unknown as Reflector;
    guard = new PermissionGuard(reflector, rbac as unknown as RbacService);
  });

  it('checks "at any site" without @SiteScope', async () => {
    route(PermissionCode.DossierRead);

    await expect(guard.canActivate(context({}))).resolves.toBe(true);
    expect(rbac.hasPermission).toHaveBeenCalledWith(
      'u-1',
      PermissionCode.DossierRead,
    );
  });

  it("checks the permission at the targeted resource's site", async () => {
    route(PermissionCode.DossierClose, fromParam('dossier'));
    rbac.resolveSiteId.mockResolvedValue('s-B');
    rbac.hasPermissionAtSite.mockResolvedValue(false);

    await expect(
      guard.canActivate(context({ params: { id: 'd-1' } })),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(rbac.resolveSiteId).toHaveBeenCalledWith('dossier', 'd-1');
    expect(rbac.hasPermissionAtSite).toHaveBeenCalledWith(
      'u-1',
      PermissionCode.DossierClose,
      's-B',
    );
    expect(rbac.hasPermission).not.toHaveBeenCalled();
  });

  it('requires the permission at every targeted site (dossier moved)', async () => {
    route(
      PermissionCode.DossierUpdate,
      fromParam('dossier'),
      fromBody('site', 'siteId'),
    );
    rbac.resolveSiteId
      .mockResolvedValueOnce('s-A') // the dossier's current site
      .mockResolvedValueOnce('s-B'); // the site it moves to
    rbac.hasPermissionAtSite.mockImplementation((_u, _c, siteId) =>
      Promise.resolve(siteId === 's-A'),
    );

    await expect(
      guard.canActivate(
        context({ params: { id: 'd-1' }, body: { siteId: 's-B' } }),
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(rbac.hasPermissionAtSite).toHaveBeenCalledTimes(2);
  });

  it('falls back to "at any site" when the resource has no site yet', async () => {
    route(PermissionCode.CourrierRead, fromParam('courrier'));
    rbac.resolveSiteId.mockResolvedValue(null); // sortant draft, no dossier

    await expect(
      guard.canActivate(context({ params: { id: 'c-1' } })),
    ).resolves.toBe(true);
    expect(rbac.hasPermission).toHaveBeenCalled();
    expect(rbac.hasPermissionAtSite).not.toHaveBeenCalled();
  });

  it('leaves unknown resources and absent fields to the service', async () => {
    route(PermissionCode.DossierCreate, fromBody('site', 'siteId'));

    await expect(guard.canActivate(context({ body: {} }))).resolves.toBe(true);
    expect(rbac.resolveSiteId).not.toHaveBeenCalled();
    expect(rbac.hasPermission).toHaveBeenCalled();
  });

  describe('platform administration', () => {
    it('requires a global grant for a platform permission', async () => {
      route(PermissionCode.AdminManageCategories);
      rbac.hasGlobalPermission.mockResolvedValue(false); // held at a site only

      await expect(guard.canActivate(context({}))).rejects.toBeInstanceOf(
        ForbiddenException,
      );
      expect(rbac.hasGlobalPermission).toHaveBeenCalledWith(
        'u-1',
        PermissionCode.AdminManageCategories,
      );
      expect(rbac.hasPermission).not.toHaveBeenCalled();
    });

    it('lets a platform administrator through', async () => {
      route(PermissionCode.AdminManageCategories);
      rbac.hasGlobalPermission.mockResolvedValue(true);

      await expect(guard.canActivate(context({}))).resolves.toBe(true);
    });

    it('requires a global grant on a @PlatformOnly route', async () => {
      route(PermissionCode.AdminManageSites);
      metadata[PLATFORM_ONLY_METADATA_KEY] = true;
      rbac.hasGlobalPermission.mockResolvedValue(false);

      await expect(guard.canActivate(context({}))).rejects.toBeInstanceOf(
        ForbiddenException,
      );
    });

    it('checks a site-scoped permission at that site', async () => {
      route(PermissionCode.AdminManageSites, fromParam('site', 'uuid'));
      rbac.resolveSiteId.mockImplementation((_entity: string, id: string) =>
        Promise.resolve(id),
      );
      rbac.hasPermissionAtSite.mockImplementation(
        (_user: string, _permission: string, siteId: string) =>
          Promise.resolve(siteId === 's-A'),
      );

      await expect(
        guard.canActivate(context({ params: { uuid: 's-A' } })),
      ).resolves.toBe(true);
      await expect(
        guard.canActivate(context({ params: { uuid: 's-B' } })),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('requires all permissions when multiple are specified', async () => {
      metadata[PERMISSION_METADATA_KEY] = [
        PermissionCode.LivrableDeposit,
        PermissionCode.LivrableSubmit,
      ];
      rbac.hasPermission.mockImplementation(
        (_user: string, code: PermissionCode) =>
          Promise.resolve(code === PermissionCode.LivrableDeposit),
      );

      await expect(guard.canActivate(context({}))).rejects.toBeInstanceOf(
        ForbiddenException,
      );

      rbac.hasPermission.mockResolvedValue(true);
      await expect(guard.canActivate(context({}))).resolves.toBe(true);
    });
  });
});
