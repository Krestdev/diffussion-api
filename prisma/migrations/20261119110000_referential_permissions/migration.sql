-- Projects get their own permissions, like contracts and correspondents.
INSERT INTO "permission" ("id", "code", "description", "display", "createdAt", "updatedAt")
VALUES
  (gen_random_uuid()::text, 'PROJECT_READ', 'Consulter les projets', true, now(), now()),
  (gen_random_uuid()::text, 'PROJECT_CREATE', 'Créer un projet', true, now(), now()),
  (gen_random_uuid()::text, 'PROJECT_UPDATE', 'Modifier un projet', true, now(), now())
ON CONFLICT ("code") DO NOTHING;

-- These permissions start being checked: whoever could already act keeps it.
INSERT INTO "role_permission" ("permissionId", "roleId")
SELECT DISTINCT target."id", rp."roleId"
FROM (VALUES
  -- Managing the referentials.
  ('ADMIN_MANAGE_REFERENTIALS', 'CONTRACT_READ'),
  ('ADMIN_MANAGE_REFERENTIALS', 'CONTRACT_CREATE'),
  ('ADMIN_MANAGE_REFERENTIALS', 'CONTRACT_UPDATE'),
  ('ADMIN_MANAGE_REFERENTIALS', 'CONTRACT_ARCHIVE'),
  ('ADMIN_MANAGE_REFERENTIALS', 'CORRESPONDENT_READ'),
  ('ADMIN_MANAGE_REFERENTIALS', 'CORRESPONDENT_CREATE'),
  ('ADMIN_MANAGE_REFERENTIALS', 'CORRESPONDENT_UPDATE'),
  ('ADMIN_MANAGE_REFERENTIALS', 'CORRESPONDENT_ARCHIVE'),
  ('ADMIN_MANAGE_REFERENTIALS', 'PROJECT_READ'),
  ('ADMIN_MANAGE_REFERENTIALS', 'PROJECT_CREATE'),
  ('ADMIN_MANAGE_REFERENTIALS', 'PROJECT_UPDATE'),
  -- Registering and dispatching effets picks from these lists.
  ('COURRIER_READ', 'CONTRACT_READ'),
  ('COURRIER_READ', 'CORRESPONDENT_READ'),
  ('COURRIER_READ', 'PROJECT_READ'),
  -- The administration screens.
  ('ADMIN_MANAGE_ROLES', 'ROLES_READ'),
  ('ADMIN_MANAGE_USERS', 'ROLES_READ'),
  ('ADMIN_MANAGE_SETTINGS', 'SETTINGS_READ')
) AS g("source", "target")
JOIN "permission" source ON source."code" = g."source"
JOIN "permission" target ON target."code" = g."target"
JOIN "role_permission" rp ON rp."permissionId" = source."id"
ON CONFLICT DO NOTHING;
