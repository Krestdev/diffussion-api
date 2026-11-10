import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtAuthGuard } from './jwt-auth.guard';

describe('JwtAuthGuard — pending password change', () => {
  const context = {
    getHandler: () => () => undefined,
    getClass: () => class {},
  } as unknown as ExecutionContext;

  const guardWith = (open: boolean) => {
    const reflector = new Reflector();
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(open);
    return new JwtAuthGuard(reflector);
  };
  const account = (mustChangePassword: boolean) => ({
    sub: 'u-1',
    email: 'a@b.c',
    mustChangePassword,
  });

  it('blocks a route that is not open to it', () => {
    expect(() =>
      guardWith(false).handleRequest(null, account(true), null, context),
    ).toThrow(ForbiddenException);
  });

  it('lets through a route open to it', () => {
    expect(
      guardWith(true).handleRequest(null, account(true), null, context),
    ).toEqual(account(true));
  });

  it('leaves other accounts alone', () => {
    expect(
      guardWith(false).handleRequest(null, account(false), null, context),
    ).toEqual(account(false));
  });
});
