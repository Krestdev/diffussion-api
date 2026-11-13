-- DASHBOARD_GLOBAL_READ can now be held at a site, where it covers that site
-- only. The "Admin" role of the existing sites gets it, as new sites' do.
INSERT INTO "role_permission" ("permissionId", "roleId")
SELECT p."id", r."id"
FROM "permission" p
CROSS JOIN "role" r
WHERE p."code" = 'DASHBOARD_GLOBAL_READ'
  AND r."name" = 'Admin'
  AND r."siteId" IS NOT NULL
  AND r."archivedAt" IS NULL
ON CONFLICT DO NOTHING;

UPDATE "permission"
SET "description" = 'Consulter les tableaux de bord de son site (de tous les sites avec un rôle global)'
WHERE "code" = 'DASHBOARD_GLOBAL_READ';
