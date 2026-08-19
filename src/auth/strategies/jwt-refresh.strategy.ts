import { Injectable } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { Request } from 'express';
import { ExtractJwt, Strategy } from 'passport-jwt';
import {
  JwtPayload,
  JwtPayloadWithRefreshToken,
} from '../types/jwt-payload.type';

@Injectable()
export class JwtRefreshStrategy extends PassportStrategy(
  Strategy,
  'jwt-refresh',
) {
  constructor() {
    const secret = process.env.JWT_REFRESH_SECRET;
    if (!secret) {
      throw new Error(
        'Missing required environment variable: JWT_REFRESH_SECRET',
      );
    }
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: secret,
      passReqToCallback: true,
    });
  }

  validate(req: Request, payload: JwtPayload): JwtPayloadWithRefreshToken {
    const refreshToken = ExtractJwt.fromAuthHeaderAsBearerToken()(req);
    return { ...payload, refreshToken: refreshToken ?? '' };
  }
}
