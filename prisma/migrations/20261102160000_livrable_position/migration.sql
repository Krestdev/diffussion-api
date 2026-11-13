-- AlterTable
ALTER TABLE "livrable" ADD COLUMN "position" INTEGER NOT NULL DEFAULT 0;

-- The livrables already there: numbered per task in the order they were
-- created (the id settles those created together), every version taking
-- the position of the livrable it is a version of.
WITH RECURSIVE "chain" AS (
  SELECT "id", "id" AS "rootId"
  FROM "livrable"
  WHERE "parentVersionId" IS NULL
  UNION ALL
  SELECT l."id", c."rootId"
  FROM "livrable" AS l
  JOIN "chain" AS c ON l."parentVersionId" = c."id"
),
"roots" AS (
  SELECT "id",
         ROW_NUMBER() OVER (
           PARTITION BY "instructionId" ORDER BY "createdAt", "id"
         ) - 1 AS "position"
  FROM "livrable"
  WHERE "parentVersionId" IS NULL
)
UPDATE "livrable" AS l
SET "position" = r."position"
FROM "chain" AS c
JOIN "roots" AS r ON r."id" = c."rootId"
WHERE l."id" = c."id";
