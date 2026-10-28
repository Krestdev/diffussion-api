-- A site's responsible makes and manages the roles of their site. Existing
-- roles stay global (siteId null), usable on every site.

ALTER TABLE "role" ADD COLUMN "siteId" TEXT;

ALTER TABLE "role" ADD CONSTRAINT "role_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "site"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- A name is unique among the global roles and within each site. NULLS NOT
-- DISTINCT: two global roles can't share a name either.
DROP INDEX "role_name_key";

CREATE UNIQUE INDEX "role_siteId_name_key" ON "role"("siteId", "name") NULLS NOT DISTINCT;
