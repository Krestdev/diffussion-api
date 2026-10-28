/**
 * `typ` tells an access token from a refresh token: each is accepted only
 * where it belongs (JwtStrategy, JwtRefreshStrategy, RealtimeGateway), even
 * if both happen to be signed with the same secret.
 */
export type TokenType = 'access' | 'refresh';

export type JwtPayload = {
  sub: string;
  email: string;
  typ?: TokenType;
};

export type JwtPayloadWithRefreshToken = JwtPayload & {
  refreshToken: string;
};

export type AuthTokens = {
  accessToken: string;
  refreshToken: string;
};
