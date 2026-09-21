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
