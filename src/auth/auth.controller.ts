import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { AuthService } from './auth.service';
import { CurrentUser } from './decorators/current-user.decorator';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { JwtPayloadWithRefreshToken } from './types/jwt-payload.type';

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('register')
  register(@Body() dto: RegisterDto) {
    return this.authService.register(dto);
  }

  @Post('login')
  @HttpCode(HttpStatus.OK)
  login(@Body() dto: LoginDto) {
    return this.authService.login(dto);
  }

  // @UseGuards(JwtRefreshGuard)
  // @ApiBearerAuth()
  // @Post('refresh')
  // @HttpCode(HttpStatus.OK)
  // refresh(@CurrentUser() user: JwtPayloadWithRefreshToken) {
  //   return this.authService.refreshTokens(user.sub, user.refreshToken);
  // }

  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  async logout(@CurrentUser() user: JwtPayloadWithRefreshToken) {
    await this.authService.logout(user.sub);
  }

  // @UseGuards(JwtAuthGuard)
  // @ApiBearerAuth()
  // @Get('me')
  // me(@CurrentUser() user: JwtPayloadWithRefreshToken) {
  //   return this.authService.me(user.sub);
  // }
}
