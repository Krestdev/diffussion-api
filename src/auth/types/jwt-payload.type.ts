export type JwtPayload = {
  sub: string;
  email: string;
};

export type JwtPayloadWithRefreshToken = JwtPayload & {
  refreshToken: string;
};

export type AuthTokens = {
  accessToken: string;
  refreshToken: string;
};
