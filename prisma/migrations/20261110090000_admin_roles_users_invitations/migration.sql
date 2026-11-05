-- CreateEnum
CREATE TYPE "AccessProfile" AS ENUM ('SUPER_ADMIN', 'COMPANY_ADMIN', 'USER');

-- AlterTable
ALTER TABLE "role" ADD COLUMN     "archivedAt" TIMESTAMP(3),
ADD COLUMN     "archivedById" TEXT;

-- AlterTable
ALTER TABLE "user" ADD COLUMN     "accessProfile" "AccessProfile" NOT NULL DEFAULT 'USER',
ADD COLUMN     "deactivatedAt" TIMESTAMP(3),
ADD COLUMN     "deactivatedById" TEXT;

-- CreateTable
CREATE TABLE "invitation" (
    "id" TEXT NOT NULL,
    "email" VARCHAR(150) NOT NULL,
    "name" TEXT NOT NULL,
    "siteId" TEXT,
    "roleId" TEXT,
    "invitedById" TEXT,
    "tokenHash" TEXT NOT NULL,
    "sentAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "acceptedAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "userId" TEXT,

    CONSTRAINT "invitation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "invitation_tokenHash_key" ON "invitation"("tokenHash");

-- CreateIndex
CREATE UNIQUE INDEX "invitation_userId_key" ON "invitation"("userId");

-- CreateIndex
CREATE INDEX "invitation_siteId_idx" ON "invitation"("siteId");

-- CreateIndex
CREATE INDEX "invitation_email_idx" ON "invitation"("email");

-- AddForeignKey
ALTER TABLE "user" ADD CONSTRAINT "user_deactivatedById_fkey" FOREIGN KEY ("deactivatedById") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "role" ADD CONSTRAINT "role_archivedById_fkey" FOREIGN KEY ("archivedById") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invitation" ADD CONSTRAINT "invitation_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "site"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invitation" ADD CONSTRAINT "invitation_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "role"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invitation" ADD CONSTRAINT "invitation_invitedById_fkey" FOREIGN KEY ("invitedById") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invitation" ADD CONSTRAINT "invitation_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- ------------------------------------------------------------- backfill
-- Profiles: platform administrators (a global grant of user administration),
-- then site administrators (a site's responsible, or user administration at
-- a site); everyone else stays USER.
UPDATE "user" u SET "accessProfile" = 'SUPER_ADMIN'
WHERE EXISTS (
  SELECT 1 FROM "user_role" ur
  JOIN "role_permission" rp ON rp."roleId" = ur."roleId"
  JOIN "permission" p ON p."id" = rp."permissionId"
  WHERE ur."userId" = u."id" AND ur."siteId" IS NULL AND p."code" = 'ADMIN_MANAGE_USERS');

UPDATE "user" u SET "accessProfile" = 'COMPANY_ADMIN'
WHERE u."accessProfile" = 'USER' AND (
  EXISTS (SELECT 1 FROM "site" s WHERE s."responsibleId" = u."id")
  OR EXISTS (
    SELECT 1 FROM "user_role" ur
    JOIN "role_permission" rp ON rp."roleId" = ur."roleId"
    JOIN "permission" p ON p."id" = rp."permissionId"
    WHERE ur."userId" = u."id" AND ur."siteId" IS NOT NULL AND p."code" = 'ADMIN_MANAGE_USERS'));

-- Suspended accounts: their last change is the best known date.
UPDATE "user" SET "deactivatedAt" = "updatedAt" WHERE "status" = 'SUSPENDED';

-- New permissions (the seed keeps them in step too), granted to the
-- platform administrators' role.
INSERT INTO "permission" ("id", "code", "description", "display", "createdAt", "updatedAt")
SELECT gen_random_uuid()::text, v.code, v.label, true, now(), now()
FROM (VALUES
  ('CONTRACT_READ', 'Consulter les contrats'),
  ('CONTRACT_CREATE', 'Créer un contrat'),
  ('CONTRACT_UPDATE', 'Modifier un contrat'),
  ('CONTRACT_ARCHIVE', 'Archiver un contrat'),
  ('CORRESPONDENT_READ', 'Consulter les correspondants'),
  ('CORRESPONDENT_CREATE', 'Créer un correspondant'),
  ('CORRESPONDENT_UPDATE', 'Modifier un correspondant'),
  ('CORRESPONDENT_ARCHIVE', 'Archiver un correspondant'),
  ('COURRIER_UPDATE', 'Modifier un effet entrant'),
  ('COURRIER_ARCHIVE', 'Archiver un effet'),
  ('COURRIER_APPROVE', 'Approuver un effet sortant'),
  ('COURRIER_CLOSE', 'Clôturer tout effet entrant'),
  ('COURRIER_READ_ALL', 'Consulter tous les effets (hors liste d''autorisés)'),
  ('ANALYSIS_ARCHIVE', 'Archiver une fiche d''analyse'),
  ('USERS_READ', 'Consulter les utilisateurs'),
  ('ROLES_READ', 'Consulter les rôles'),
  ('ROLES_CREATE', 'Créer un rôle'),
  ('ROLES_ARCHIVE', 'Archiver un rôle'),
  ('SETTINGS_READ', 'Consulter les paramètres')
) AS v(code, label)
ON CONFLICT ("code") DO NOTHING;

INSERT INTO "role_permission" ("permissionId", "roleId")
SELECT p."id", r."id" FROM "permission" p, "role" r
WHERE r."name" = 'Administrateur' AND r."siteId" IS NULL
  AND p."code" IN ('CONTRACT_READ','CONTRACT_CREATE','CONTRACT_UPDATE','CONTRACT_ARCHIVE',
    'CORRESPONDENT_READ','CORRESPONDENT_CREATE','CORRESPONDENT_UPDATE','CORRESPONDENT_ARCHIVE',
    'COURRIER_UPDATE','COURRIER_ARCHIVE','COURRIER_APPROVE','COURRIER_CLOSE','COURRIER_READ_ALL',
    'ANALYSIS_ARCHIVE','USERS_READ','ROLES_READ','ROLES_CREATE','ROLES_ARCHIVE','SETTINGS_READ')
ON CONFLICT DO NOTHING;
