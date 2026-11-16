import { HttpException } from '@nestjs/common';
import { ActivityService } from '../../activity/activity.service';
import { ALL_PERMISSIONS, Permission } from '../../auth/permissions';
import { AppClsStore } from '../../cls.store';
import { AppAccessService } from '../../core/app-access.service';
import { DatabaseService } from '../../database/database.service';
import { RoleService } from './role.service';
import type { ClsService } from 'nestjs-cls';

const P = Permission;

/** A role row as ROLE_INCLUDE reads it. */
const role = (over: Record<string, unknown> = {}) => ({
  id: 'r-1',
  code: 'RO-1',
  name: 'Agent',
  description: null,
  isSystem: false,
  companyId: 's-1',
  company: { id: 's-1', name: 'Douala' },
  archivedAt: null,
  archivedBy: null,
  formerUsersCount: 0,
  createdAt: new Date(0),
  updatedAt: new Date(0),
  rolePermissions: [] as { permission: { code: string } }[],
  _count: { userRoles: 0 },
  ...over,
});

const codeOf = (error: unknown) =>
  ((error as HttpException).getResponse() as { code?: string }).code;

describe('RoleService', () => {
  let service: RoleService;
  let cls: Record<string, unknown>;
  let db: {
    role: Record<string, jest.Mock>;
    rolePermission: Record<string, jest.Mock>;
    permission: Record<string, jest.Mock>;
    user: Record<string, jest.Mock>;
    userRole: Record<string, jest.Mock>;
    delegation: Record<string, jest.Mock>;
    $transaction: jest.Mock;
  };
  let refresh: jest.Mock;

  beforeEach(() => {
    cls = { userId: 'u-1', permissions: [...ALL_PERMISSIONS] };
    db = {
      role: {
        findFirst: jest.fn().mockResolvedValue(role()),
        findMany: jest.fn().mockResolvedValue([]),
        findUnique: jest.fn(),
        create: jest.fn().mockResolvedValue(role()),
        update: jest.fn(),
        count: jest.fn().mockResolvedValue(0),
      },
      rolePermission: { deleteMany: jest.fn(), createMany: jest.fn() },
      permission: {
        findMany: jest.fn(({ where }: { where: { code: { in: string[] } } }) =>
          Promise.resolve(where.code.in.map((code) => ({ id: code, code }))),
        ),
        createMany: jest.fn(),
      },
      user: {
        findUnique: jest.fn(),
        findMany: jest.fn().mockResolvedValue([]),
        count: jest.fn().mockResolvedValue(1),
      },
      userRole: {
        findMany: jest.fn().mockResolvedValue([]),
        deleteMany: jest.fn(),
        createMany: jest.fn(),
      },
      delegation: {
        findMany: jest.fn().mockResolvedValue([]),
        updateMany: jest.fn(),
      },
      $transaction: jest.fn((fn: (tx: unknown) => unknown) => fn(db)),
    };
    refresh = jest.fn();
    service = new RoleService(
      db as unknown as DatabaseService,
      { tryRecord: jest.fn() } as unknown as ActivityService,
      {
        refresh,
        compute: jest.fn().mockResolvedValue(new Map()),
      } as unknown as AppAccessService,
      {
        isActive: () => true,
        get: (key: string) => cls[key],
      } as unknown as ClsService<AppClsStore>,
    );
  });

  it('serves the catalogue grouped, labelled, with the implied reads', () => {
    const catalog = service.catalog();
    expect(catalog.version).toBe('2.1.0');
    const incoming = catalog.groups.find((g) => g.key === 'incoming');
    expect(incoming?.labels.fr).toBe('Effets entrants');
    expect(incoming?.permissions.map((p) => p.action)).toContain(
      'dispatch.validate',
    );
    expect(catalog.implies[P.ROLE_ASSIGN]).toEqual([P.ROLE_READ, P.USER_READ]);
  });

  it('creates a role with the reads its actions imply', async () => {
    db.role.findFirst.mockResolvedValue(null);
    await service.create('s-1', {
      name: 'Agent',
      permissions: [P.INCOMING_CREATE],
    });
    const { data } = db.role.create.mock.calls[0][0] as {
      data: { rolePermissions: { create: { permissionId: string }[] } };
    };
    expect(data.rolePermissions.create.map((c) => c.permissionId)).toEqual([
      P.INCOMING_READ,
      P.INCOMING_CREATE,
      P.CORRESPONDENT_READ,
    ]);
  });

  it('refuses an unknown code (UNKNOWN_PERMISSION)', async () => {
    const error = await service
      .create('s-1', { name: 'X', permissions: ['COURRIER_READ'] })
      .catch((e: unknown) => e);
    expect(codeOf(error)).toBe('UNKNOWN_PERMISSION');
  });

  it('G4: grants only codes the person holds (PERMISSION_NOT_HELD)', async () => {
    cls.permissions = [P.ROLE_UPDATE, P.ROLE_READ];
    const error = await service
      .setPermissions('s-1', 'r-1', [P.AUDIT_READ])
      .catch((e: unknown) => e);
    expect(codeOf(error)).toBe('PERMISSION_NOT_HELD');
    // The core's console is not bound by it.
    cls.coreActor = { name: 'Admin', platform: false };
    await service.setPermissions('s-1', 'r-1', [P.AUDIT_READ]);
    expect(db.rolePermission.createMany).toHaveBeenCalled();
  });

  it('protects the ADMIN role (SYSTEM_ROLE_PROTECTED)', async () => {
    db.role.findFirst.mockResolvedValue(
      role({ code: 'ADMIN', isSystem: true }),
    );
    for (const call of [
      () => service.setPermissions('s-1', 'r-1', []),
      () => service.archive('s-1', 'r-1'),
      () => service.remove('s-1', 'r-1'),
    ]) {
      expect(codeOf(await call().catch((e: unknown) => e))).toBe(
        'SYSTEM_ROLE_PROTECTED',
      );
    }
  });

  it('refuses to delete a role still held (ROLE_IN_USE), archives an unheld one', async () => {
    db.role.findFirst.mockResolvedValue(role({ _count: { userRoles: 2 } }));
    expect(
      codeOf(await service.remove('s-1', 'r-1').catch((e: unknown) => e)),
    ).toBe('ROLE_IN_USE');
    db.role.findFirst.mockResolvedValue(role());
    await service.remove('s-1', 'r-1');
    expect(db.role.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'r-1' },
        data: expect.objectContaining({
          archivedAt: expect.any(Date) as unknown,
        }) as unknown,
      }),
    );
  });

  it('G3: nobody changes their own roles from Diffusion (CANNOT_MODIFY_SELF)', async () => {
    const error = await service
      .setUserRoles('s-1', 'u-1', [])
      .catch((e: unknown) => e);
    expect(codeOf(error)).toBe('CANNOT_MODIFY_SELF');
  });

  it('G4: gives only roles whose codes the person all holds', async () => {
    cls.permissions = [P.ROLE_ASSIGN, P.ROLE_READ, P.USER_READ];
    db.user.findUnique.mockResolvedValue({
      id: 'u-2',
      name: 'B',
      companyId: 's-1',
      userRoles: [],
    });
    db.role.findMany.mockResolvedValue([
      {
        id: 'r-1',
        name: 'Audit',
        companyId: 's-1',
        archivedAt: null,
        rolePermissions: [{ permission: { code: P.AUDIT_READ } }],
      },
    ]);
    const error = await service
      .setUserRoles('s-1', 'u-2', ['r-1'])
      .catch((e: unknown) => e);
    expect(codeOf(error)).toBe('PERMISSION_NOT_HELD');
    expect(db.userRole.createMany).not.toHaveBeenCalled();
  });

  it('refuses a role of another company', async () => {
    db.user.findUnique.mockResolvedValue({
      id: 'u-2',
      name: 'B',
      companyId: 's-1',
      userRoles: [],
    });
    db.role.findMany.mockResolvedValue([
      {
        id: 'r-9',
        name: 'Ailleurs',
        companyId: 's-2',
        archivedAt: null,
        rolePermissions: [],
      },
    ]);
    await expect(
      service.setUserRoles('s-1', 'u-2', ['r-9']),
    ).rejects.toBeInstanceOf(HttpException);
  });

  it('G5: archiving hands the holders the replacement and refreshes them', async () => {
    db.role.findUnique.mockResolvedValue(role({ id: 'r-2' }));
    db.userRole.findMany.mockResolvedValue([{ userId: 'u-3' }]);
    await service.archive('s-1', 'r-1', { reassignToRoleId: 'r-2' });
    expect(db.userRole.createMany).toHaveBeenCalledWith({
      data: [{ userId: 'u-3', roleId: 'r-2' }],
      skipDuplicates: true,
    });
    expect(db.userRole.deleteMany).toHaveBeenCalledWith({
      where: { roleId: 'r-1' },
    });
    expect(refresh).toHaveBeenCalledWith(['u-3']);
  });
});
