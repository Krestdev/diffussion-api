-- A delegation now hands over one ROLE at one SITE for a period, instead of a
-- free-text "responsibility". The table is empty, so the columns are added as
-- required outright.
ALTER TABLE "delegation" ALTER COLUMN "responsibility" DROP NOT NULL;
ALTER TABLE "delegation" ADD COLUMN "roleId" TEXT NOT NULL;
ALTER TABLE "delegation" ADD COLUMN "siteId" TEXT NOT NULL;
ALTER TABLE "delegation" ADD COLUMN "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

CREATE INDEX "delegation_delegataireId_roleId_siteId_idx" ON "delegation"("delegataireId", "roleId", "siteId");

ALTER TABLE "delegation" ADD CONSTRAINT "delegation_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "role"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "delegation" ADD CONSTRAINT "delegation_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "site"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
