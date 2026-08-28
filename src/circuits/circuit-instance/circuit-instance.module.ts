import { Module } from '@nestjs/common';
import { NotificationsModule } from '../../notifications/notifications.module';
import { CircuitInstanceController } from './circuit-instance.controller';
import { CircuitInstanceService } from './circuit-instance.service';

@Module({
  imports: [NotificationsModule],
  controllers: [CircuitInstanceController],
  providers: [CircuitInstanceService],
  exports: [CircuitInstanceService],
})
export class CircuitInstanceModule {}
