-- Marks the current version of each livrable; a version replaced by a newer
-- one (any livrable pointing at it as parent) is no longer the latest.
ALTER TABLE "livrable" ADD COLUMN "isLatest" BOOLEAN NOT NULL DEFAULT true;

UPDATE "livrable" l SET "isLatest" = false
WHERE EXISTS (SELECT 1 FROM "livrable" c WHERE c."parentVersionId" = l."id");
