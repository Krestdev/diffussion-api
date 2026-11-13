-- Reference lists (PA·7) and effet types' description (PA·4).

-- ---------------------------------------------------------- effet types
ALTER TABLE "effet_type" ADD COLUMN "description" TEXT;

-- --------------------------------------------------------------- canaux
ALTER TABLE "canal" ADD COLUMN "active" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN "description" TEXT;

-- ------------------------------------------------------- contract types
-- The fixed list becomes a table; a contract keeps its kind's code.
CREATE TABLE "contract_type" (
    "id" TEXT NOT NULL,
    "code" VARCHAR(30) NOT NULL,
    "label" VARCHAR(100) NOT NULL,
    "description" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "order" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "contract_type_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "contract_type_code_key" ON "contract_type"("code");

INSERT INTO "contract_type" ("id", "code", "label", "order", "updatedAt") VALUES
  (gen_random_uuid()::text, 'MOE', 'Maîtrise d''œuvre', 1, now()),
  (gen_random_uuid()::text, 'AMO', 'Assistance à maîtrise d''ouvrage', 2, now()),
  (gen_random_uuid()::text, 'TRAVAUX', 'Travaux', 3, now()),
  (gen_random_uuid()::text, 'ETUDES', 'Études', 4, now()),
  (gen_random_uuid()::text, 'CONTROLE', 'Contrôle', 5, now()),
  (gen_random_uuid()::text, 'AUTRE', 'Autre', 6, now());

-- Kept, not dropped: the enum value becomes its code.
ALTER TABLE "contract" ALTER COLUMN "type" TYPE VARCHAR(30) USING "type"::text;
DROP TYPE "ContractType";
ALTER TABLE "contract" ADD CONSTRAINT "contract_type_fkey" FOREIGN KEY ("type") REFERENCES "contract_type"("code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- --------------------------------------------------- correspondent types
-- They now belong to a site: every site gets its own copy of each, its
-- correspondents move onto it, and the shared originals go.
DROP INDEX "correspondent_type_name_key";
ALTER TABLE "correspondent_type" ADD COLUMN "active" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN "description" TEXT,
ADD COLUMN "siteId" TEXT;

CREATE TEMP TABLE ct_copy AS
SELECT t."id" AS old_id, s."id" AS site_id, gen_random_uuid()::text AS new_id
FROM "correspondent_type" t CROSS JOIN "site" s
WHERE t."siteId" IS NULL;

INSERT INTO "correspondent_type" ("id", "name", "siteId", "createdAt", "updatedAt")
SELECT c.new_id, t."name", c.site_id, t."createdAt", now()
FROM ct_copy c JOIN "correspondent_type" t ON t."id" = c.old_id;

UPDATE "correspondent" r SET "typeId" = c.new_id
FROM ct_copy c
WHERE r."typeId" = c.old_id AND r."siteId" = c.site_id;

DELETE FROM "correspondent_type" WHERE "siteId" IS NULL;
DROP TABLE ct_copy;

ALTER TABLE "correspondent_type" ALTER COLUMN "siteId" SET NOT NULL;
CREATE UNIQUE INDEX "correspondent_type_siteId_name_key" ON "correspondent_type"("siteId", "name");
ALTER TABLE "correspondent_type" ADD CONSTRAINT "correspondent_type_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "site"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- --------------------------------------------------------- dossier types
CREATE TABLE "dossier_type" (
    "id" TEXT NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "description" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "siteId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "dossier_type_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "dossier_type_siteId_name_key" ON "dossier_type"("siteId", "name");
ALTER TABLE "dossier_type" ADD CONSTRAINT "dossier_type_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "site"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "dossier" ADD COLUMN "typeId" TEXT;
ALTER TABLE "dossier" ADD CONSTRAINT "dossier_typeId_fkey" FOREIGN KEY ("typeId") REFERENCES "dossier_type"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
