import { Module } from '@nestjs/common';
import { EventsModule } from '../../events/events.module';
import { UsersService } from './users.service';
import { UsersController } from './users.controller';

@Module({
  imports: [EventsModule],
  controllers: [UsersController],
  providers: [UsersService],
})
export class UsersModule {}
