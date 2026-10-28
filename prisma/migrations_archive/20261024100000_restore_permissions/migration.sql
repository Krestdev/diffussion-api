-- Restores the permissions dropped by 20261023100000_remove_unused_permissions
-- (ADMIN_MANAGE_SETTINGS came back in 20261024090000), granted again to the
-- "Administrateur" role.

INSERT INTO "permission" ("id", "code", "description", "display", "updatedAt")
VALUES
  (gen_random_uuid()::text, 'COURRIER_UPDATE_DRAFT', 'Modifier un brouillon de courrier', true, now()),
  (gen_random_uuid()::text, 'INSTRUCTION_REASSIGN', 'Réaffecter une tâche', true, now()),
  (gen_random_uuid()::text, 'INSTRUCTION_ACCEPT', 'Accepter une tâche', true, now()),
  (gen_random_uuid()::text, 'LIVRABLE_DOWNLOAD', 'Télécharger les livrables', true, now()),
  (gen_random_uuid()::text, 'VALIDATION_VERIFY', 'Vérifier les livrables', true, now())
ON CONFLICT ("code") DO NOTHING;

INSERT INTO "role_permission" ("permissionId", "roleId")
SELECT p."id", r."id"
FROM "permission" p, "role" r
WHERE p."code" IN (
    'COURRIER_UPDATE_DRAFT',
    'INSTRUCTION_REASSIGN',
    'INSTRUCTION_ACCEPT',
    'LIVRABLE_DOWNLOAD',
    'VALIDATION_VERIFY'
  )
  AND r."name" = 'Administrateur'
  AND r."siteId" IS NULL
ON CONFLICT DO NOTHING;
