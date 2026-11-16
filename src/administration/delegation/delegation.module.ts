import { Module } from '@nestjs/common';
import { NotificationsModule } from '../../notifications/notifications.module';
import { DelegationService } from './delegation.service';
import { DelegationController } from './delegation.controller';

@Module({
  // The delegataire and the delegant are notified live.
  imports: [NotificationsModule],
  controllers: [DelegationController],
  providers: [DelegationService],
})
export class DelegationModule {}
