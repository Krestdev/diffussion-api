-- ADMIN_MANAGE_SETTINGS is back, granted to the administrators: the
-- "Administrateur" role (super-admin globally, site responsibles at their
-- site).

INSERT INTO "permission" ("id", "code", "description", "display", "updatedAt")
VALUES (gen_random_uuid()::text, 'ADMIN_MANAGE_SETTINGS', 'Gérer les paramètres', true, now())
ON CONFLICT ("code") DO NOTHING;

INSERT INTO "role_permission" ("permissionId", "roleId")
SELECT p."id", r."id"
FROM "permission" p, "role" r
WHERE p."code" = 'ADMIN_MANAGE_SETTINGS'
  AND r."name" = 'Administrateur'
  AND r."siteId" IS NULL
ON CONFLICT DO NOTHING;
