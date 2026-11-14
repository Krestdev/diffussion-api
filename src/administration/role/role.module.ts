import { Module } from '@nestjs/common';
import { AppAdminController } from './app-admin.controller';
import { RoleController } from './role.controller';
import { RoleService } from './role.service';

@Module({
  controllers: [RoleController, AppAdminController],
  providers: [RoleService],
  exports: [RoleService],
})
export class RoleModule {}
