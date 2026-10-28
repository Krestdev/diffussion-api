import { Module } from '@nestjs/common';
import { NotificationsModule } from '../notifications/notifications.module';
import { InstructionLatenessService } from './instruction-lateness.service';
import { InstructionsService } from './instructions.service';
import { InstructionsController } from './instructions.controller';

@Module({
  imports: [NotificationsModule],
  controllers: [InstructionsController],
  providers: [InstructionsService, InstructionLatenessService],
  // Livrable decisions (DeliverableController.reject) live with the rest of
  // the instruction's validation round.
  exports: [InstructionsService],
})
export class InstructionsModule {}
