-- Single-use, short-lived password reset grants (only the token digest is stored).
CREATE TABLE "password_reset_token" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "password_reset_token_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "password_reset_token_tokenHash_key" ON "password_reset_token"("tokenHash");
CREATE INDEX "password_reset_token_userId_idx" ON "password_reset_token"("userId");

ALTER TABLE "password_reset_token" ADD CONSTRAINT "password_reset_token_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;
