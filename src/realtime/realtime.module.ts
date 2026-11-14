import { Global, Module } from '@nestjs/common';
import { RealtimeGateway } from './realtime.gateway';

// Global so any service can push an event without importing this module.
@Global()
@Module({
  providers: [RealtimeGateway],
  exports: [RealtimeGateway],
})
export class RealtimeModule {}
