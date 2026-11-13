-- A user now belongs to exactly one site (User.siteId), replacing the
-- many-to-many Assignment table. A site administrator manages only the users
-- of their own site; platform users (super-admins) have no site and hold
-- their roles globally.
--
-- Existing data:
-- - a user holding ADMIN_MANAGE_USERS through a global grant is a platform
--   user: no site, and their site grants are dropped (the global ones cover
--   everything);
-- - any other user keeps their earliest assignment as their site; their
--   global grants become grants at that site, and grants at any other site
--   are dropped;
-- - delegations to a site the delegataire no longer belongs to are dropped.

ALTER TABLE "user" ADD COLUMN "siteId" TEXT;

CREATE TEMP TABLE "_platform_user" AS
SELECT DISTINCT ur."userId"
FROM "user_role" ur
JOIN "role_permission" rp ON rp."roleId" = ur."roleId"
JOIN "permission" p ON p."id" = rp."permissionId"
WHERE ur."siteId" IS NULL
  AND p."code" = 'ADMIN_MANAGE_USERS';

UPDATE "user" u
SET "siteId" = (
  SELECT a."siteId"
  FROM "assignment" a
  WHERE a."userId" = u."id"
  ORDER BY a."createdAt", a."id"
  LIMIT 1
)
WHERE u."id" NOT IN (SELECT "userId" FROM "_platform_user");

-- Platform users: global grants only.
DELETE FROM "user_role" ur
WHERE ur."userId" IN (SELECT "userId" FROM "_platform_user")
  AND ur."siteId" IS NOT NULL;

-- Site users: grants at another site go.
DELETE FROM "user_role" ur
USING "user" u
WHERE ur."userId" = u."id"
  AND u."siteId" IS NOT NULL
  AND ur."siteId" IS NOT NULL
  AND ur."siteId" <> u."siteId";

-- Site users: a global grant already held at their site is redundant...
DELETE FROM "user_role" ur
USING "user" u
WHERE ur."userId" = u."id"
  AND u."siteId" IS NOT NULL
  AND ur."siteId" IS NULL
  AND EXISTS (
    SELECT 1 FROM "user_role" other
    WHERE other."userId" = ur."userId"
      AND other."roleId" = ur."roleId"
      AND other."siteId" = u."siteId"
  );

-- ...and the remaining ones move to their site.
UPDATE "user_role" ur
SET "siteId" = u."siteId"
FROM "user" u
WHERE ur."userId" = u."id"
  AND u."siteId" IS NOT NULL
  AND ur."siteId" IS NULL;

-- A site's responsible is its administrator and must belong to it: a
-- responsible who doesn't (a platform user, or someone kept in another site)
-- is unset — a platform administrator names a new one.
UPDATE "site" s
SET "responsibleId" = NULL
FROM "user" u
WHERE s."responsibleId" = u."id"
  AND u."siteId" IS DISTINCT FROM s."id";

DELETE FROM "delegation" d
USING "user" u
WHERE d."delegataireId" = u."id"
  AND u."siteId" IS DISTINCT FROM d."siteId";

DROP TABLE "_platform_user";

DROP TABLE "assignment";

CREATE INDEX "user_siteId_idx" ON "user"("siteId");

ALTER TABLE "user" ADD CONSTRAINT "user_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "site"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
