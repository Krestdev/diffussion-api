import { Global, Module } from '@nestjs/common';
import { AccessService } from './access.service';
import { PermissionsGuard } from './permissions.guard';
import { PermissionsUpgradeService } from '../permissions-upgrade.service';

/**
 * People's permissions in their company, the guard checking routes against them, and the
 * start-up upgrade of every company's roles to the current catalogue.
 */
@Global()
@Module({
  providers: [AccessService, PermissionsGuard, PermissionsUpgradeService],
  exports: [AccessService, PermissionsGuard],
})
export class AccessModule {}
