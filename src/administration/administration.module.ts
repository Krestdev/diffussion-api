import { Module } from '@nestjs/common';
import { RoleModule } from './role/role.module';
import { PermissionModule } from './permission/permission.module';
import { DelegationModule } from './delegation/delegation.module';
import { UsersModule } from './users/users.module';

@Module({
  imports: [RoleModule, PermissionModule, DelegationModule, UsersModule],
})
export class AdministrationModule {}
