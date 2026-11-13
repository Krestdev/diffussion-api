import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Query,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { AcceptInvitationDto } from './dto/invitation.dto';
import { UsersService } from './users.service';

/**
 * The invitee's side, without an account yet: read the invitation behind a
 * link, then accept it with a password — which creates the account.
 */
@ApiTags('auth')
@Controller('auth/invitations')
export class InvitationsController {
  constructor(private readonly usersService: UsersService) {}

  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @Get()
  read(@Query('token') token: string) {
    return this.usersService.invitationByToken(token);
  }

  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post('accept')
  @HttpCode(HttpStatus.CREATED)
  accept(@Body() dto: AcceptInvitationDto) {
    return this.usersService.acceptInvitation(dto);
  }
}
