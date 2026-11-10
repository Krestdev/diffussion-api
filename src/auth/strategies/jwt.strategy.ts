import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { ClsService } from 'nestjs-cls';
import { JwtPayload } from '../types/jwt-payload.type';
import { AppClsStore } from '../../cls.store';
import { DatabaseService } from '../../database/database.service';
import { UserStatus } from 'generated/prisma/enums';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy, 'jwt') {
  constructor(
    private readonly cls: ClsService<AppClsStore>,
    private readonly database: DatabaseService,
  ) {
    const secret = process.env.JWT_SECRET;
    if (!secret)
      throw new Error('Missing required environment variable: JWT_SECRET');
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: secret,
    });
  }

  // A valid signature alone isn't enough: the account may have been deleted
  // or suspended since the token was issued, and access tokens must stop
  // working immediately rather than at their expiry.
  async validate(payload: JwtPayload): Promise<JwtPayload> {
    // A refresh token is not an access token, whatever its signature.
    if (payload.typ !== 'access') {
      throw new UnauthorizedException('An access token is required');
    }
    const user = await this.database.user.findUnique({
      where: { id: payload.sub },
      select: { status: true, mustChangePassword: true },
    });
    if (!user || user.status !== UserStatus.ACTIVE) {
      throw new UnauthorizedException('Account is no longer active');
    }

    this.cls.set('userId', payload.sub);
    this.cls.set('actorLabel', payload.email);
    return { ...payload, mustChangePassword: user.mustChangePassword };
  }
}
