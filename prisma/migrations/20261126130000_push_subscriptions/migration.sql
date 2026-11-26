-- Browser notifications (« Notifications du navigateur »): the Web Push subscriptions of each
-- person's browsers, so notifications reach them while no Diffusion tab is open, and the
-- person's choice (console « Mon profil »: on by default, each browser still asks first).
ALTER TABLE "user" ADD COLUMN "browserNotifications" BOOLEAN NOT NULL DEFAULT true;

CREATE TABLE "push_subscription" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "endpoint" TEXT NOT NULL,
    "p256dh" TEXT NOT NULL,
    "auth" TEXT NOT NULL,
    "language" VARCHAR(5) NOT NULL DEFAULT 'fr',
    "userAgent" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastUsedAt" TIMESTAMP(3),

    CONSTRAINT "push_subscription_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "push_subscription_endpoint_key" ON "push_subscription"("endpoint");

CREATE INDEX "push_subscription_userId_idx" ON "push_subscription"("userId");

ALTER TABLE "push_subscription" ADD CONSTRAINT "push_subscription_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;
