import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../../database/database.service';
import { PermissionCode } from './rbac.constants';

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
}
