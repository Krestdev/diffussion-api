-- Roles become held per site (or globally, siteId null) instead of applying
-- on every site the user is assigned to. Existing rights are preserved:
-- - a role granting a lockout-critical permission (ADMIN_MANAGE_USERS /
--   ADMIN_MANAGE_ROLES), or held by a user with no assignment, stays a
--   single global row;
-- - any other role is split into one row per site the user is assigned to.

ALTER TABLE "user_role" DROP CONSTRAINT "user_role_pkey";
ALTER TABLE "user_role" ADD COLUMN "id" TEXT;
ALTER TABLE "user_role" ADD COLUMN "siteId" TEXT;

CREATE TEMP TABLE "_critical_role" AS
SELECT DISTINCT rp."roleId"
FROM "role_permission" rp
JOIN "permission" p ON p."id" = rp."permissionId"
WHERE p."code" IN ('ADMIN_MANAGE_USERS', 'ADMIN_MANAGE_ROLES');

INSERT INTO "user_role" ("id", "userId", "roleId", "siteId")
SELECT gen_random_uuid()::text, ur."userId", ur."roleId", a."siteId"
FROM "user_role" ur
JOIN "assignment" a ON a."userId" = ur."userId"
WHERE ur."id" IS NULL
  AND ur."roleId" NOT IN (SELECT "roleId" FROM "_critical_role");

-- The original rows that were just split per site.
DELETE FROM "user_role" ur
WHERE ur."id" IS NULL
  AND ur."roleId" NOT IN (SELECT "roleId" FROM "_critical_role")
  AND EXISTS (SELECT 1 FROM "assignment" a WHERE a."userId" = ur."userId");

-- What is left are the global grants.
UPDATE "user_role" SET "id" = gen_random_uuid()::text WHERE "id" IS NULL;

DROP TABLE "_critical_role";

ALTER TABLE "user_role" ALTER COLUMN "id" SET NOT NULL;
ALTER TABLE "user_role" ADD CONSTRAINT "user_role_pkey" PRIMARY KEY ("id");

-- NULLS NOT DISTINCT: a global grant (siteId null) can't be duplicated.
CREATE UNIQUE INDEX "user_role_userId_roleId_siteId_key" ON "user_role"("userId", "roleId", "siteId") NULLS NOT DISTINCT;
CREATE INDEX "user_role_siteId_roleId_idx" ON "user_role"("siteId", "roleId");

ALTER TABLE "user_role" ADD CONSTRAINT "user_role_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "site"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
