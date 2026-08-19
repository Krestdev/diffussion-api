import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { Request } from 'express';
import { JwtPayloadWithRefreshToken } from '../types/jwt-payload.type';

export const CurrentUser = createParamDecorator(
  (
    _data: unknown,
    ctx: ExecutionContext,
  ): JwtPayloadWithRefreshToken | undefined => {
    const request = ctx
      .switchToHttp()
      .getRequest<Request & { user?: JwtPayloadWithRefreshToken }>();
    return request.user;
  },
);
