import { Global, Module } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { ChangesInterceptor } from './changes.interceptor';
import { RealtimeGateway } from './realtime.gateway';

// Global so any service can push an event without importing this module.
@Global()
@Module({
  providers: [
    RealtimeGateway,
    // Every successful modification is announced live to the company's tabs (as EXPENZO).
    { provide: APP_INTERCEPTOR, useClass: ChangesInterceptor },
  ],
  exports: [RealtimeGateway],
})
export class RealtimeModule {}
