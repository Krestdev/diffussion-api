-- Effets are typed: courrier, bordereau de transmission, matière ou
-- spécimen, document, support numérique, dossier complet. Types are global
-- (made by a platform administrator) or a site's own (made by its
-- responsible). Physical effets get quantity, condition, packaging,
-- location and return; a bordereau lists the effets it accompanies.
-- Additive only: every new column is optional, existing effets become
-- "Courrier".

-- AlterTable
ALTER TABLE "courrier" ADD COLUMN     "conditionOnReceipt" VARCHAR(255),
ADD COLUMN     "packaging" VARCHAR(255),
ADD COLUMN     "parentId" TEXT,
ADD COLUMN     "physicalDescription" TEXT,
ADD COLUMN     "quantity" INTEGER,
ADD COLUMN     "returnExpected" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "returnedAt" TIMESTAMP(3),
ADD COLUMN     "storageLocation" VARCHAR(255),
ADD COLUMN     "typeId" TEXT;

-- CreateTable
CREATE TABLE "effet_type" (
    "id" TEXT NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "isPhysical" BOOLEAN NOT NULL DEFAULT false,
    "canListEffets" BOOLEAN NOT NULL DEFAULT false,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "siteId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "effet_type_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
-- NULLS NOT DISTINCT: two global types (siteId null) can't share a name.
CREATE UNIQUE INDEX "effet_type_siteId_name_key" ON "effet_type"("siteId", "name") NULLS NOT DISTINCT;

-- CreateIndex
CREATE INDEX "courrier_typeId_idx" ON "courrier"("typeId");

-- CreateIndex
CREATE INDEX "courrier_parentId_idx" ON "courrier"("parentId");

-- AddForeignKey
ALTER TABLE "effet_type" ADD CONSTRAINT "effet_type_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "site"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "courrier" ADD CONSTRAINT "courrier_typeId_fkey" FOREIGN KEY ("typeId") REFERENCES "effet_type"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "courrier" ADD CONSTRAINT "courrier_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "courrier"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- Starting list, global: every site can use it; each site's responsible can
-- add types of their own.
INSERT INTO "effet_type" ("id", "name", "isPhysical", "canListEffets", "updatedAt")
VALUES
  (gen_random_uuid()::text, 'Courrier', false, false, now()),
  (gen_random_uuid()::text, 'Bordereau de transmission', false, true, now()),
  (gen_random_uuid()::text, 'Matière / spécimen', true, false, now()),
  (gen_random_uuid()::text, 'Document', false, false, now()),
  (gen_random_uuid()::text, 'Support numérique', true, false, now()),
  (gen_random_uuid()::text, 'Dossier complet', true, false, now());

UPDATE "courrier"
SET "typeId" = (SELECT "id" FROM "effet_type" WHERE "name" = 'Courrier' AND "siteId" IS NULL)
WHERE "typeId" IS NULL;
