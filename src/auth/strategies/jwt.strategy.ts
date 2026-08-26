import { Injectable } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { ClsService } from 'nestjs-cls';
import { JwtPayload } from '../types/jwt-payload.type';
import { AppClsStore } from '../../cls.store';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy, 'jwt') {
  constructor(private readonly cls: ClsService<AppClsStore>) {
    const secret = process.env.JWT_SECRET;
    if (!secret)
      throw new Error('Missing required environment variable: JWT_SECRET');
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: secret,
    });
  }

  validate(payload: JwtPayload): JwtPayload {
    this.cls.set('userId', payload.sub);
    this.cls.set('actorLabel', payload.email);
    return payload;
  }
}
