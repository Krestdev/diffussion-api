-- Projects now belong to one site.
ALTER TABLE "project" ADD COLUMN "siteId" TEXT;

-- The site holding most of its dossiers...
UPDATE "project" p SET "siteId" = (
  SELECT d."siteId" FROM "dossier" d WHERE d."projectId" = p."id"
  GROUP BY d."siteId" ORDER BY count(*) DESC, d."siteId" LIMIT 1)
WHERE p."siteId" IS NULL;

-- ...else of its effets (their dossier's site, else their registrant's)...
UPDATE "project" p SET "siteId" = (
  SELECT COALESCE(d."siteId", u."siteId") FROM "courrier" c
  LEFT JOIN "dossier" d ON d."id" = c."dossierId"
  LEFT JOIN "user" u ON u."id" = c."createdById"
  WHERE c."projectId" = p."id" AND COALESCE(d."siteId", u."siteId") IS NOT NULL
  GROUP BY 1 ORDER BY count(*) DESC, 1 LIMIT 1)
WHERE p."siteId" IS NULL;

-- ...else its responsible's, else the oldest site.
UPDATE "project" p SET "siteId" = u."siteId"
FROM "user" u WHERE u."id" = p."responsibleId" AND p."siteId" IS NULL;
UPDATE "project" SET "siteId" = (SELECT "id" FROM "site" ORDER BY "createdAt", "id" LIMIT 1)
WHERE "siteId" IS NULL;

ALTER TABLE "project" ALTER COLUMN "siteId" SET NOT NULL;
CREATE INDEX "project_siteId_idx" ON "project"("siteId");
ALTER TABLE "project" ADD CONSTRAINT "project_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "site"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
