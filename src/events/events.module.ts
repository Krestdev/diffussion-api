import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { EventsGateway } from './events.gateway';

@Module({
  // Registered empty, same as AuthModule — each call site (here, the
  // gateway's handleConnection) passes its secret explicitly.
  imports: [JwtModule.register({})],
  providers: [EventsGateway],
  exports: [EventsGateway],
})
export class EventsModule {}
