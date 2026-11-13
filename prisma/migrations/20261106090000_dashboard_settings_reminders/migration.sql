-- AlterTable
ALTER TABLE "instruction" ADD COLUMN     "lastRemindedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "app_settings" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "maxActiveInstructionsPerAgent" INTEGER,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "app_settings_pkey" PRIMARY KEY ("id")
);


INSERT INTO "app_settings" ("id", "updatedAt") VALUES (1, CURRENT_TIMESTAMP);

-- Backfill: an entrant closed before closedAt existed was closed when its
-- journal says so, else at its last update.
UPDATE "courrier" c
SET "closedAt" = COALESCE(
  (SELECT MIN(l."createdAt") FROM "activity_log" l
   WHERE l."entityType" = 'Courrier' AND l."entityId" = c."id"
     AND l."action" = 'COURRIER_CLOTURE'),
  c."updatedAt")
WHERE c."direction" = 'ENTRANT' AND c."closedAt" IS NULL
  AND (c."status" = 'CLOTURE'
       OR (c."status" = 'ARCHIVE' AND c."archivedFromStatus" = 'CLOTURE'));
