-- Services (departments) were never used: no user was ever attached to one
-- and nothing gated or routed on them. Dropped, with their permission.

DROP TABLE "user_service";

DROP TABLE "service";

DELETE FROM "role_permission" rp
USING "permission" p
WHERE rp."permissionId" = p."id"
  AND p."code" = 'ADMIN_MANAGE_SERVICES';

DELETE FROM "permission" WHERE "code" = 'ADMIN_MANAGE_SERVICES';
