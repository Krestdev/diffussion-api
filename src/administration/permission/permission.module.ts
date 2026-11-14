import { Module } from '@nestjs/common';
import { RoleModule } from '../role/role.module';
import { PermissionController } from './permission.controller';

@Module({
  imports: [RoleModule],
  controllers: [PermissionController],
})
export class PermissionModule {}
