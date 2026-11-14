import { Module } from '@nestjs/common';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';

/**
 * People sign in, refresh, change their password and sign out at the CREAPP core; Diffusion only
 * says who is calling (GET /auth/me). See CoreAuthGuard.
 */
@Module({
  controllers: [AuthController],
  providers: [AuthService],
})
export class AuthModule {}
