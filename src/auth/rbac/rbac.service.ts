import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../../database/database.service';
import { PermissionCode } from './rbac.constants';

@Injectable()
export class RbacService {
  constructor(private readonly database: DatabaseService) {}

  // Walks Utilisateur -> Affectation -> Role -> RolePermission -> Permission
  // and returns the deduped set of permission codes the user holds across
  // every affectation/role they have.
  async getPermissionCodes(utilisateurUuid: string): Promise<string[]> {
    const affectations = await this.database.assignment.findMany({
      where: { userId: utilisateurUuid },
      include: {
        roles: {
          include: {
            rolePermissions: {
              include: { permission: true },
            },
          },
        },
      },
    });

    const codes = new Set<string>();
    for (const affectation of affectations) {
      for (const role of affectation.roles) {
        for (const rolePermission of role.rolePermissions) {
          if (rolePermission.permission.name) {
            codes.add(rolePermission.permission.name);
          }
        }
      }
    }

    return [...codes];
  }

  async hasPermission(
    utilisateurUuid: string,
    permission: PermissionCode,
  ): Promise<boolean> {
    const codes = await this.getPermissionCodes(utilisateurUuid);
    return codes.includes(permission);
  }
}
