-- Canaux and correspondents now belong to one site.
DROP INDEX "canal_name_key";
ALTER TABLE "canal" ADD COLUMN "siteId" TEXT;
ALTER TABLE "correspondent" ADD COLUMN "siteId" TEXT;

-- The site of each effet: its dossier's, else its registrant's.
CREATE TEMP TABLE effet_site AS
SELECT c."id", c."canalId", c."correspondentId",
       COALESCE(d."siteId", u."siteId") AS "siteId"
FROM "courrier" c
LEFT JOIN "dossier" d ON d."id" = c."dossierId"
LEFT JOIN "user" u ON u."id" = c."createdById";

-- ---------------------------------------------------------------- canaux
-- Each canal goes to the site using it most; every other site using it
-- gets its own copy, and that site's effets move onto the copy.
CREATE TEMP TABLE canal_use AS
SELECT "canalId" AS "id", "siteId",
       row_number() OVER (PARTITION BY "canalId" ORDER BY count(*) DESC, "siteId") AS rk
FROM effet_site
WHERE "canalId" IS NOT NULL AND "siteId" IS NOT NULL
GROUP BY "canalId", "siteId";

UPDATE "canal" SET "siteId" = u."siteId"
FROM canal_use u WHERE u."id" = "canal"."id" AND u.rk = 1;

CREATE TEMP TABLE canal_copy AS
SELECT u."id" AS old_id, u."siteId", gen_random_uuid()::text AS new_id
FROM canal_use u WHERE u.rk > 1;

INSERT INTO "canal" ("id", "name", "siteId", "createdAt", "updatedAt")
SELECT cc.new_id, c."name", cc."siteId", c."createdAt", now()
FROM canal_copy cc JOIN "canal" c ON c."id" = cc.old_id;

UPDATE "courrier" SET "canalId" = cc.new_id
FROM canal_copy cc, effet_site e
WHERE e."id" = "courrier"."id" AND e."canalId" = cc.old_id
  AND e."siteId" = cc."siteId";

-- ------------------------------------------------------- correspondents
CREATE TEMP TABLE corr_use AS
SELECT "correspondentId" AS "id", "siteId",
       row_number() OVER (PARTITION BY "correspondentId" ORDER BY count(*) DESC, "siteId") AS rk
FROM effet_site
WHERE "correspondentId" IS NOT NULL AND "siteId" IS NOT NULL
GROUP BY "correspondentId", "siteId";

UPDATE "correspondent" SET "siteId" = u."siteId"
FROM corr_use u WHERE u."id" = "correspondent"."id" AND u.rk = 1;

CREATE TEMP TABLE corr_copy AS
SELECT u."id" AS old_id, u."siteId", gen_random_uuid()::text AS new_id
FROM corr_use u WHERE u.rk > 1;

INSERT INTO "correspondent" ("id", "code", "name", "typeId", "address", "city",
  "country", "email", "phone", "mainContact", "status", "siteId", "createdAt", "updatedAt")
SELECT cc.new_id, left(c."code", 20) || '-' || left(s."code", 9), c."name", c."typeId",
       c."address", c."city", c."country", c."email", c."phone", c."mainContact",
       c."status", cc."siteId", c."createdAt", now()
FROM corr_copy cc
JOIN "correspondent" c ON c."id" = cc.old_id
JOIN "site" s ON s."id" = cc."siteId";

UPDATE "courrier" SET "correspondentId" = cc.new_id
FROM corr_copy cc, effet_site e
WHERE e."id" = "courrier"."id" AND e."correspondentId" = cc.old_id
  AND e."siteId" = cc."siteId";

-- Used by no effet: the site of the dossiers of the projects / contracts
-- it is the maître d'ouvrage or client of.
UPDATE "correspondent" c SET "siteId" = (
  SELECT d."siteId" FROM "dossier" d
  WHERE d."projectId" IN (SELECT p."id" FROM "project" p WHERE p."maitreOuvrageId" = c."id")
     OR d."contractId" IN (SELECT k."id" FROM "contract" k WHERE k."clientId" = c."id")
  GROUP BY d."siteId" ORDER BY count(*) DESC, d."siteId" LIMIT 1)
WHERE c."siteId" IS NULL;

-- Anything left: the oldest site.
UPDATE "canal" SET "siteId" = (SELECT "id" FROM "site" ORDER BY "createdAt", "id" LIMIT 1)
WHERE "siteId" IS NULL;
UPDATE "correspondent" SET "siteId" = (SELECT "id" FROM "site" ORDER BY "createdAt", "id" LIMIT 1)
WHERE "siteId" IS NULL;

DROP TABLE effet_site, canal_use, canal_copy, corr_use, corr_copy;

ALTER TABLE "canal" ALTER COLUMN "siteId" SET NOT NULL;
ALTER TABLE "correspondent" ALTER COLUMN "siteId" SET NOT NULL;

CREATE UNIQUE INDEX "canal_siteId_name_key" ON "canal"("siteId", "name");
CREATE INDEX "correspondent_siteId_idx" ON "correspondent"("siteId");

ALTER TABLE "canal" ADD CONSTRAINT "canal_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "site"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "correspondent" ADD CONSTRAINT "correspondent_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "site"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
