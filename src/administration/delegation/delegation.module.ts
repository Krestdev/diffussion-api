import { Module } from '@nestjs/common';
import { DelegationService } from './delegation.service';
import { DelegationController } from './delegation.controller';

@Module({
  controllers: [DelegationController],
  providers: [DelegationService],
})
export class DelegationModule {}
