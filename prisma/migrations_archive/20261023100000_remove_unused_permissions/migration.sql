-- Permissions no route ever checked: dropped from every role, then from the
-- catalogue.

DELETE FROM "role_permission" rp
USING "permission" p
WHERE rp."permissionId" = p."id"
  AND p."code" IN (
    'COURRIER_UPDATE_DRAFT',
    'INSTRUCTION_ACCEPT',
    'INSTRUCTION_REASSIGN',
    'LIVRABLE_DOWNLOAD',
    'VALIDATION_VERIFY',
    'ADMIN_MANAGE_SETTINGS'
  );

DELETE FROM "permission"
WHERE "code" IN (
  'COURRIER_UPDATE_DRAFT',
  'INSTRUCTION_ACCEPT',
  'INSTRUCTION_REASSIGN',
  'LIVRABLE_DOWNLOAD',
  'VALIDATION_VERIFY',
  'ADMIN_MANAGE_SETTINGS'
);
