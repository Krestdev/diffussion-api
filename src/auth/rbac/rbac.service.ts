import { ConflictException, Injectable } from '@nestjs/common';
import { Prisma, UserStatus } from '../../../generated/prisma/client';
import { DatabaseService } from '../../database/database.service';
import { PermissionCode } from './rbac.constants';

// Permissions that must always be held by at least one active user,
// otherwise nobody could ever manage users/roles again (lockout).
const LOCKOUT_CRITICAL_PERMISSIONS = [
  PermissionCode.AdminManageUsers,
  PermissionCode.AdminManageRoles,
];

@Injectable()
export class RbacService {
  constructor(private readonly database: DatabaseService) {}

  /**
   * Delegations in force right now for this user: each gives them one role
   * at one site (see Delegation in schema.prisma). `endDate` is an inclusive
   * day, so a delegation ending today is still active.
   */
  private activeDelegationsFilter(): Prisma.DelegationWhereInput {
    const now = new Date();
    const startOfToday = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
    );
    return { startDate: { lte: now }, endDate: { gte: startOfToday } };
  }

  /** Role/site pairs this user currently holds through a delegation. */
  async activeDelegatedRoles(
    userUuid: string,
  ): Promise<{ roleId: string; siteId: string }[]> {
    return this.database.delegation.findMany({
      where: { delegataireId: userUuid, ...this.activeDelegationsFilter() },
      select: { roleId: true, siteId: true },
    });
  }

  /**
   * "Does this user act with `roleId` at `siteId` right now?" — either they
   * hold the role and are assigned to the site, or a delegation currently
   * grants them exactly that role there.
   */
  async hasRoleAtSite(
    userUuid: string,
    roleId: string,
    siteId: string | null,
  ): Promise<boolean> {
    if (!siteId) return false;
    const [hasRole, isAssigned, delegated] = await Promise.all([
      this.database.userRole.findFirst({ where: { userId: userUuid, roleId } }),
      this.database.assignment.findFirst({
        where: { userId: userUuid, siteId },
      }),
      this.database.delegation.findFirst({
        where: {
          delegataireId: userUuid,
          roleId,
          siteId,
          ...this.activeDelegationsFilter(),
        },
        select: { id: true },
      }),
    ]);
    return (hasRole !== null && isAssigned !== null) || delegated !== null;
  }

  /** Everyone who can act with `roleId` at `siteId` right now. */
  async usersWithRoleAtSite(
    roleId: string | null,
    siteId: string | null,
  ): Promise<string[]> {
    if (!roleId || !siteId) return [];
    const [holders, delegates] = await Promise.all([
      this.database.user.findMany({
        where: {
          userRoles: { some: { roleId } },
          assignments: { some: { siteId } },
        },
        select: { id: true },
      }),
      this.database.delegation.findMany({
        where: { roleId, siteId, ...this.activeDelegationsFilter() },
        select: { delegataireId: true },
      }),
    ]);
    return [
      ...new Set([
        ...holders.map((u) => u.id),
        ...delegates.map((d) => d.delegataireId),
      ]),
    ];
  }

  /**
   * All (roleId, siteId) pairs the given user can act on right now —
   * used by the "awaiting my decision" filter in CircuitInstanceService.
   * Combines direct role+assignment pairs with active delegations.
   */
  async eligibleRoleSitePairs(
    userId: string,
  ): Promise<{ roleId: string; siteId: string }[]> {
    const [direct, delegated] = await Promise.all([
      // Roles the user holds directly × sites they are assigned to
      this.database.userRole.findMany({
        where: { userId },
        select: {
          roleId: true,
          user: { select: { assignments: { select: { siteId: true } } } },
        },
      }),
      // Roles granted by an active delegation (already scoped to one site each)
      this.database.delegation.findMany({
        where: { delegataireId: userId, ...this.activeDelegationsFilter() },
        select: { roleId: true, siteId: true },
      }),
    ]);

    const pairs = new Map<string, { roleId: string; siteId: string }>();
    for (const ur of direct) {
      for (const { siteId } of ur.user.assignments) {
        const key = `${ur.roleId}:${siteId}`;
        pairs.set(key, { roleId: ur.roleId, siteId });
      }
    }
    for (const d of delegated) {
      const key = `${d.roleId}:${d.siteId}`;
      pairs.set(key, { roleId: d.roleId, siteId: d.siteId });
    }
    return [...pairs.values()];
  }


  // Walks User -> UserRole -> Role -> RolePermission -> Permission and
  // returns the deduped set of permission codes the user holds. Roles are
  // held directly by the user (RG-ORG-003: a user may exercise several
  // responsibilities at once) rather than scoped to a single site
  // assignment, so this no longer goes through Assignment.
  async getPermissionCodes(userUuid: string): Promise<string[]> {
    const userRoles = await this.database.userRole.findMany({
      where: { userId: userUuid },
      include: {
        role: {
          include: {
            rolePermissions: {
              include: { permission: true },
            },
          },
        },
      },
    });

    const codes = new Set<string>();
    for (const userRole of userRoles) {
      for (const rolePermission of userRole.role.rolePermissions) {
        codes.add(rolePermission.permission.code);
      }
    }

    // Roles held through an active delegation count too. The *permission*
    // check itself stays global (a permission carries no site today), so
    // this widens what the user may do; the site restriction currently
    // bites on circuit steps, via hasRoleAtSite.
    const delegated = await this.database.delegation.findMany({
      where: { delegataireId: userUuid, ...this.activeDelegationsFilter() },
      select: {
        role: {
          select: {
            rolePermissions: {
              select: { permission: { select: { code: true } } },
            },
          },
        },
      },
    });
    for (const delegation of delegated) {
      for (const rolePermission of delegation.role.rolePermissions) {
        codes.add(rolePermission.permission.code);
      }
    }

    return [...codes];
  }

  async hasPermission(
    userUuid: string,
    permission: PermissionCode,
  ): Promise<boolean> {
    const codes = await this.getPermissionCodes(userUuid);
    return codes.includes(permission);
  }

  /**
   * Runs an administration change (user roles/status/deletion, role
   * permissions) and commits it only if every lockout-critical permission
   * is still held by at least one active user afterwards. Serializable so
   * two concurrent changes can't each remove "the other" last admin.
   */
  async withAdminCoverage<T>(
    change: (tx: Prisma.TransactionClient) => Promise<T>,
  ): Promise<T> {
    try {
      return await this.database.$transaction(
        async (tx) => {
          const result = await change(tx);
          await this.assertAdminCoverage(tx);
          return result;
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      );
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2034'
      ) {
        throw new ConflictException(
          'Another administration change happened at the same time, please retry',
        );
      }
      throw error;
    }
  }

  private async assertAdminCoverage(tx: Prisma.TransactionClient) {
    for (const code of LOCKOUT_CRITICAL_PERMISSIONS) {
      const holders = await tx.user.count({
        where: {
          status: UserStatus.ACTIVE,
          userRoles: {
            some: {
              role: { rolePermissions: { some: { permission: { code } } } },
            },
          },
        },
      });
      if (holders === 0) {
        throw new ConflictException(
          `This change would leave no active user holding ${code}`,
        );
      }
    }
  }
}
