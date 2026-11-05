import { Module } from '@nestjs/common';
import { UsersService } from './users.service';
import { UsersController } from './users.controller';
import { InvitationsController } from './invitations.controller';

@Module({
  controllers: [UsersController, InvitationsController],
  providers: [UsersService],
})
export class UsersModule {}
