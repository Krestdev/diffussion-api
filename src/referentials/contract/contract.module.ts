import { Module } from '@nestjs/common';
import { NotificationsModule } from '../../notifications/notifications.module';
import { ContractController } from './contract.controller';
import { ContractService } from './contract.service';

@Module({
  imports: [NotificationsModule],
  controllers: [ContractController],
  providers: [ContractService],
})
export class ContractModule {}
