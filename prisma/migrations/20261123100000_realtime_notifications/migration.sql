-- Real-time notifications, as EXPENZO's (owner, 2026-11-16): each notification keeps the
-- parameters of its text, so each reader sees it in their own language, and where it comes from
-- (reminder:<item>:<period>, digest:<day>…), so a reminder job never sends it twice.
ALTER TABLE "notification" ADD COLUMN "params" JSONB;
ALTER TABLE "notification" ADD COLUMN "sourceKey" VARCHAR(200);

CREATE UNIQUE INDEX "notification_sourceKey_key" ON "notification"("sourceKey");
