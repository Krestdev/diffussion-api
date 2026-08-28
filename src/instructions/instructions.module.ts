import { Module } from '@nestjs/common';
import { NotificationsModule } from '../notifications/notifications.module';
import { InstructionsService } from './instructions.service';
import { InstructionsController } from './instructions.controller';

@Module({
  imports: [NotificationsModule],
  controllers: [InstructionsController],
  providers: [InstructionsService],
})
export class InstructionsModule {}
