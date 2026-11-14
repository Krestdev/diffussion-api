-- Permissions 2.0.0 (owner decisions, 2026-11-14): Diffusion's permissions rebuilt the way EXPENZO
-- does it. Codes become `resource.action` (src/auth/permissions.ts, REPLACES_2_0_0); roles belong
-- to ONE company (no global roles); each company has a protected system role ADMIN holding every
-- permission, given to its administrators; a role grant no longer names a company (the role does).

-- 1. Each company follows a catalogue version; roles may be default (system) ones.
ALTER TABLE "company" ADD COLUMN "permissionsVersion" VARCHAR(20) NOT NULL DEFAULT '2.0.0';
ALTER TABLE "role" ADD COLUMN "isSystem" BOOLEAN NOT NULL DEFAULT false;

-- 2. The new codes, then every role's old codes renamed / split / merged into them.
INSERT INTO "permission" ("id", "code", "description", "display", "createdAt", "updatedAt")
VALUES
  (gen_random_uuid()::text, 'effect.read.all', 'Consulter tous les effets de la société', true, now(), now()),
  (gen_random_uuid()::text, 'incoming.read', 'Consulter les effets entrants', true, now(), now()),
  (gen_random_uuid()::text, 'incoming.create', 'Enregistrer les effets entrants', true, now(), now()),
  (gen_random_uuid()::text, 'incoming.update', 'Modifier les effets entrants', true, now(), now()),
  (gen_random_uuid()::text, 'incoming.update.draft', 'Modifier les brouillons d''effets entrants', true, now(), now()),
  (gen_random_uuid()::text, 'incoming.dispatch', 'Dispatcher directement les effets entrants', true, now(), now()),
  (gen_random_uuid()::text, 'incoming.dispatch.validate', 'Valider les dispatchings proposés', true, now(), now()),
  (gen_random_uuid()::text, 'incoming.close', 'Clôturer tout effet entrant', true, now(), now()),
  (gen_random_uuid()::text, 'incoming.archive', 'Archiver et restaurer les effets entrants', true, now(), now()),
  (gen_random_uuid()::text, 'outgoing.read', 'Consulter les effets sortants', true, now(), now()),
  (gen_random_uuid()::text, 'outgoing.create', 'Rédiger les effets sortants', true, now(), now()),
  (gen_random_uuid()::text, 'outgoing.update', 'Modifier les effets sortants en brouillon', true, now(), now()),
  (gen_random_uuid()::text, 'outgoing.approve', 'Approuver les effets sortants', true, now(), now()),
  (gen_random_uuid()::text, 'outgoing.send', 'Signer, envoyer et décharger les effets sortants', true, now(), now()),
  (gen_random_uuid()::text, 'outgoing.archive', 'Archiver et restaurer les effets sortants', true, now(), now()),
  (gen_random_uuid()::text, 'dossier.read', 'Consulter les dossiers', true, now(), now()),
  (gen_random_uuid()::text, 'dossier.create', 'Créer des dossiers', true, now(), now()),
  (gen_random_uuid()::text, 'dossier.update', 'Modifier les dossiers', true, now(), now()),
  (gen_random_uuid()::text, 'dossier.close', 'Clôturer les dossiers', true, now(), now()),
  (gen_random_uuid()::text, 'dossier.reopen', 'Rouvrir les dossiers', true, now(), now()),
  (gen_random_uuid()::text, 'dossier.archive', 'Archiver et restaurer les dossiers', true, now(), now()),
  (gen_random_uuid()::text, 'contract.read', 'Consulter les contrats', true, now(), now()),
  (gen_random_uuid()::text, 'contract.create', 'Créer des contrats', true, now(), now()),
  (gen_random_uuid()::text, 'contract.update', 'Modifier les contrats', true, now(), now()),
  (gen_random_uuid()::text, 'contract.archive', 'Archiver et restaurer les contrats', true, now(), now()),
  (gen_random_uuid()::text, 'correspondent.read', 'Consulter les correspondants', true, now(), now()),
  (gen_random_uuid()::text, 'correspondent.create', 'Créer des correspondants', true, now(), now()),
  (gen_random_uuid()::text, 'correspondent.update', 'Modifier les correspondants', true, now(), now()),
  (gen_random_uuid()::text, 'correspondent.archive', 'Archiver et restaurer les correspondants', true, now(), now()),
  (gen_random_uuid()::text, 'project.read', 'Consulter les projets', true, now(), now()),
  (gen_random_uuid()::text, 'project.create', 'Créer des projets', true, now(), now()),
  (gen_random_uuid()::text, 'project.update', 'Modifier les projets', true, now(), now()),
  (gen_random_uuid()::text, 'project.archive', 'Clôturer, archiver et restaurer les projets', true, now(), now()),
  (gen_random_uuid()::text, 'analysis.read', 'Consulter les fiches d''analyse', true, now(), now()),
  (gen_random_uuid()::text, 'analysis.create', 'Créer des fiches d''analyse', true, now(), now()),
  (gen_random_uuid()::text, 'analysis.update', 'Modifier les fiches d''analyse', true, now(), now()),
  (gen_random_uuid()::text, 'analysis.approve', 'Prononcer l''avis et signer les fiches d''analyse', true, now(), now()),
  (gen_random_uuid()::text, 'analysis.archive', 'Archiver et restaurer les fiches d''analyse', true, now(), now()),
  (gen_random_uuid()::text, 'instruction.read', 'Consulter les tâches', true, now(), now()),
  (gen_random_uuid()::text, 'instruction.create', 'Créer des tâches', true, now(), now()),
  (gen_random_uuid()::text, 'instruction.assign', 'Affecter des tâches', true, now(), now()),
  (gen_random_uuid()::text, 'instruction.reassign', 'Réaffecter des tâches', true, now(), now()),
  (gen_random_uuid()::text, 'instruction.update', 'Modifier les tâches', true, now(), now()),
  (gen_random_uuid()::text, 'instruction.accept', 'Souscrire à une tâche', true, now(), now()),
  (gen_random_uuid()::text, 'instruction.refuse', 'Ne pas souscrire à une tâche', true, now(), now()),
  (gen_random_uuid()::text, 'instruction.cancel', 'Annuler des tâches', true, now(), now()),
  (gen_random_uuid()::text, 'instruction.close', 'Clôturer des tâches', true, now(), now()),
  (gen_random_uuid()::text, 'deliverable.read', 'Consulter les livrables', true, now(), now()),
  (gen_random_uuid()::text, 'deliverable.create', 'Déposer des livrables', true, now(), now()),
  (gen_random_uuid()::text, 'deliverable.update', 'Déposer une nouvelle version d''un livrable', true, now(), now()),
  (gen_random_uuid()::text, 'deliverable.submit', 'Soumettre les livrables à validation', true, now(), now()),
  (gen_random_uuid()::text, 'deliverable.download', 'Télécharger les livrables', true, now(), now()),
  (gen_random_uuid()::text, 'validation.verify', 'Vérifier les livrables', true, now(), now()),
  (gen_random_uuid()::text, 'validation.approve', 'Approuver les livrables', true, now(), now()),
  (gen_random_uuid()::text, 'validation.reject', 'Rejeter les livrables', true, now(), now()),
  (gen_random_uuid()::text, 'validation.return', 'Demander des corrections sur les livrables', true, now(), now()),
  (gen_random_uuid()::text, 'user.read', 'Consulter les utilisateurs', true, now(), now()),
  (gen_random_uuid()::text, 'role.read', 'Consulter les rôles et leurs permissions', true, now(), now()),
  (gen_random_uuid()::text, 'role.create', 'Créer des rôles', true, now(), now()),
  (gen_random_uuid()::text, 'role.update', 'Renommer les rôles et changer leurs permissions', true, now(), now()),
  (gen_random_uuid()::text, 'role.archive', 'Archiver et restaurer les rôles', true, now(), now()),
  (gen_random_uuid()::text, 'role.assign', 'Attribuer les rôles aux utilisateurs', true, now(), now()),
  (gen_random_uuid()::text, 'settings.read', 'Consulter les paramètres et référentiels', true, now(), now()),
  (gen_random_uuid()::text, 'settings.update', 'Modifier les paramètres et référentiels', true, now(), now()),
  (gen_random_uuid()::text, 'company.read', 'Consulter la société', true, now(), now()),
  (gen_random_uuid()::text, 'company.update', 'Modifier la ville et le responsable de la société', true, now(), now()),
  (gen_random_uuid()::text, 'audit.read', 'Consulter le journal d''audit', true, now(), now()),
  (gen_random_uuid()::text, 'dashboard.read.all', 'Consulter les tableaux de bord globaux', true, now(), now())
ON CONFLICT ("code") DO UPDATE SET "description" = EXCLUDED."description";

CREATE TEMP TABLE "tmp_replaces" ("old" TEXT NOT NULL, "new" TEXT NOT NULL);
INSERT INTO "tmp_replaces" ("old", "new") VALUES
  ('COURRIER_READ', 'incoming.read'),
  ('COURRIER_READ', 'outgoing.read'),
  ('COURRIER_READ_ALL', 'effect.read.all'),
  ('COURRIER_REGISTER_ENTRANT', 'incoming.create'),
  ('COURRIER_UPDATE_DRAFT', 'incoming.update.draft'),
  ('COURRIER_UPDATE', 'incoming.update'),
  ('COURRIER_DISPATCH', 'incoming.dispatch'),
  ('COURRIER_DISPATCH_VALIDATE', 'incoming.dispatch.validate'),
  ('COURRIER_CLOSE', 'incoming.close'),
  ('COURRIER_ARCHIVE', 'incoming.archive'),
  ('COURRIER_ARCHIVE', 'outgoing.archive'),
  ('COURRIER_WRITE_SORTANT', 'outgoing.create'),
  ('COURRIER_WRITE_SORTANT', 'outgoing.update'),
  ('COURRIER_APPROVE', 'outgoing.approve'),
  ('COURRIER_SEND', 'outgoing.send'),
  ('DOSSIER_READ', 'dossier.read'),
  ('DOSSIER_CREATE', 'dossier.create'),
  ('DOSSIER_UPDATE', 'dossier.update'),
  ('DOSSIER_CLOSE', 'dossier.close'),
  ('DOSSIER_REOPEN', 'dossier.reopen'),
  ('DOSSIER_ARCHIVE', 'dossier.archive'),
  ('CONTRACT_READ', 'contract.read'),
  ('CONTRACT_CREATE', 'contract.create'),
  ('CONTRACT_UPDATE', 'contract.update'),
  ('CONTRACT_ARCHIVE', 'contract.archive'),
  ('CORRESPONDENT_READ', 'correspondent.read'),
  ('CORRESPONDENT_CREATE', 'correspondent.create'),
  ('CORRESPONDENT_UPDATE', 'correspondent.update'),
  ('CORRESPONDENT_ARCHIVE', 'correspondent.archive'),
  ('PROJECT_READ', 'project.read'),
  ('PROJECT_CREATE', 'project.create'),
  ('PROJECT_UPDATE', 'project.update'),
  ('PROJECT_ARCHIVE', 'project.archive'),
  ('ANALYSIS_READ', 'analysis.read'),
  ('ANALYSIS_CREATE', 'analysis.create'),
  ('ANALYSIS_UPDATE', 'analysis.update'),
  ('ANALYSIS_DECIDE', 'analysis.approve'),
  ('ANALYSIS_ARCHIVE', 'analysis.archive'),
  ('INSTRUCTION_CREATE', 'instruction.create'),
  ('INSTRUCTION_ASSIGN', 'instruction.assign'),
  ('INSTRUCTION_REASSIGN', 'instruction.reassign'),
  ('INSTRUCTION_UPDATE', 'instruction.update'),
  ('INSTRUCTION_ACCEPT', 'instruction.accept'),
  ('INSTRUCTION_REFUSE', 'instruction.refuse'),
  ('INSTRUCTION_CANCEL', 'instruction.cancel'),
  ('INSTRUCTION_CLOSE', 'instruction.close'),
  ('LIVRABLE_READ', 'deliverable.read'),
  ('LIVRABLE_DEPOSIT', 'deliverable.create'),
  ('LIVRABLE_NEW_VERSION', 'deliverable.update'),
  ('LIVRABLE_SUBMIT', 'deliverable.submit'),
  ('LIVRABLE_DOWNLOAD', 'deliverable.download'),
  ('VALIDATION_VERIFY', 'validation.verify'),
  ('VALIDATION_APPROVE', 'validation.approve'),
  ('VALIDATION_REJECT', 'validation.reject'),
  ('VALIDATION_REQUEST_CORRECTIONS', 'validation.return'),
  ('USERS_READ', 'user.read'),
  ('ADMIN_MANAGE_USERS', 'role.assign'),
  ('ROLES_READ', 'role.read'),
  ('ROLES_CREATE', 'role.create'),
  ('ROLES_ARCHIVE', 'role.archive'),
  ('ADMIN_MANAGE_ROLES', 'role.create'),
  ('ADMIN_MANAGE_ROLES', 'role.update'),
  ('ADMIN_MANAGE_ROLES', 'role.archive'),
  ('SETTINGS_READ', 'settings.read'),
  ('ADMIN_MANAGE_SETTINGS', 'settings.update'),
  ('ADMIN_MANAGE_REFERENTIALS', 'settings.update'),
  ('ADMIN_MANAGE_CATEGORIES', 'settings.update'),
  ('ADMIN_MANAGE_ANALYSIS_CRITERIA', 'settings.update'),
  ('ADMIN_MANAGE_COMPANIES', 'company.update'),
  ('AUDIT_READ', 'audit.read'),
  ('DASHBOARD_GLOBAL_READ', 'dashboard.read.all');

INSERT INTO "role_permission" ("permissionId", "roleId")
SELECT DISTINCT target."id", rp."roleId"
FROM "role_permission" rp
JOIN "permission" old ON old."id" = rp."permissionId"
JOIN "tmp_replaces" r ON r."old" = old."code"
JOIN "permission" target ON target."code" = r."new"
ON CONFLICT DO NOTHING;

-- Each action brings the reads it needs (IMPLIES; implied codes imply nothing further but
-- effect.read.all, applied first).
CREATE TEMP TABLE "tmp_implies" ("action" TEXT NOT NULL, "read" TEXT NOT NULL);
INSERT INTO "tmp_implies" ("action", "read") VALUES
  ('effect.read.all', 'incoming.read'),
  ('effect.read.all', 'outgoing.read'),
  ('incoming.create', 'incoming.read'),
  ('incoming.create', 'correspondent.read'),
  ('incoming.update', 'incoming.read'),
  ('incoming.update.draft', 'incoming.read'),
  ('incoming.dispatch', 'incoming.read'),
  ('incoming.dispatch', 'contract.read'),
  ('incoming.dispatch', 'dossier.read'),
  ('incoming.dispatch.validate', 'incoming.read'),
  ('incoming.close', 'incoming.read'),
  ('incoming.archive', 'incoming.read'),
  ('outgoing.create', 'outgoing.read'),
  ('outgoing.update', 'outgoing.read'),
  ('outgoing.approve', 'outgoing.read'),
  ('outgoing.send', 'outgoing.read'),
  ('outgoing.archive', 'outgoing.read'),
  ('dossier.create', 'dossier.read'),
  ('dossier.update', 'dossier.read'),
  ('dossier.close', 'dossier.read'),
  ('dossier.reopen', 'dossier.read'),
  ('dossier.archive', 'dossier.read'),
  ('contract.create', 'contract.read'),
  ('contract.update', 'contract.read'),
  ('contract.archive', 'contract.read'),
  ('correspondent.create', 'correspondent.read'),
  ('correspondent.update', 'correspondent.read'),
  ('correspondent.archive', 'correspondent.read'),
  ('project.create', 'project.read'),
  ('project.update', 'project.read'),
  ('project.archive', 'project.read'),
  ('analysis.create', 'analysis.read'),
  ('analysis.update', 'analysis.read'),
  ('analysis.approve', 'analysis.read'),
  ('analysis.archive', 'analysis.read'),
  ('instruction.create', 'instruction.read'),
  ('instruction.assign', 'instruction.read'),
  ('instruction.reassign', 'instruction.read'),
  ('instruction.update', 'instruction.read'),
  ('instruction.accept', 'instruction.read'),
  ('instruction.refuse', 'instruction.read'),
  ('instruction.cancel', 'instruction.read'),
  ('instruction.close', 'instruction.read'),
  ('deliverable.create', 'deliverable.read'),
  ('deliverable.update', 'deliverable.read'),
  ('deliverable.submit', 'deliverable.read'),
  ('deliverable.download', 'deliverable.read'),
  ('validation.verify', 'deliverable.read'),
  ('validation.approve', 'deliverable.read'),
  ('validation.reject', 'deliverable.read'),
  ('validation.return', 'deliverable.read'),
  ('role.create', 'role.read'),
  ('role.update', 'role.read'),
  ('role.archive', 'role.read'),
  ('role.assign', 'role.read'),
  ('role.assign', 'user.read'),
  ('settings.update', 'settings.read'),
  ('company.update', 'company.read');

INSERT INTO "role_permission" ("permissionId", "roleId")
SELECT DISTINCT target."id", rp."roleId"
FROM "role_permission" rp
JOIN "permission" action ON action."id" = rp."permissionId"
JOIN "tmp_implies" i ON i."action" = action."code"
JOIN "permission" target ON target."code" = i."read"
ON CONFLICT DO NOTHING;

-- The withdrawn codes (and any code outside the catalogue) go.
DELETE FROM "role_permission"
WHERE "permissionId" IN (SELECT "id" FROM "permission" WHERE "code" !~ '^[a-z]');
DELETE FROM "permission" WHERE "code" !~ '^[a-z]';

-- 3. Global roles become company roles: each is copied into every company — in use where people
-- of that company held it (directly or through a delegation), archived elsewhere (restorable,
-- CDC G5) — its grants and delegations move to the copies, then the global original goes.
-- A code is unique within a company only (the copies keep the original's).
DROP INDEX "role_code_key";

CREATE TEMP TABLE "tmp_role_copy" (
  "oldId" TEXT NOT NULL,
  "companyId" TEXT NOT NULL,
  "newId" TEXT NOT NULL,
  "used" BOOLEAN NOT NULL
);

INSERT INTO "tmp_role_copy" ("oldId", "companyId", "newId", "used")
SELECT r."id", c."id", gen_random_uuid()::text,
  EXISTS (
    SELECT 1 FROM "user_role" ur JOIN "user" u ON u."id" = ur."userId"
    WHERE ur."roleId" = r."id" AND COALESCE(u."companyId", ur."companyId") = c."id"
  ) OR EXISTS (
    SELECT 1 FROM "delegation" d WHERE d."roleId" = r."id" AND d."companyId" = c."id"
  )
FROM "role" r CROSS JOIN "company" c
WHERE r."companyId" IS NULL;

INSERT INTO "role" (
  "id", "code", "name", "description", "companyId", "isSystem",
  "archivedAt", "archivedById", "formerUsersCount", "createdAt", "updatedAt"
)
SELECT
  t."newId",
  r."code",
  -- A company role may already have that name: the copy says where it comes from.
  CASE WHEN EXISTS (
    SELECT 1 FROM "role" same
    WHERE same."companyId" = t."companyId" AND same."name" = r."name"
  ) THEN LEFT(r."name", 40) || ' (global)' ELSE r."name" END,
  r."description",
  t."companyId",
  false,
  CASE WHEN t."used" THEN r."archivedAt" ELSE COALESCE(r."archivedAt", now()) END,
  r."archivedById",
  r."formerUsersCount",
  r."createdAt",
  now()
FROM "tmp_role_copy" t JOIN "role" r ON r."id" = t."oldId";

INSERT INTO "role_permission" ("permissionId", "roleId")
SELECT rp."permissionId", t."newId"
FROM "tmp_role_copy" t JOIN "role_permission" rp ON rp."roleId" = t."oldId";

-- Grants of a global role: to the copy of the holder's company (a person without a company, a
-- platform account, can't use Diffusion any more: their global grants go).
UPDATE "user_role" ur
SET "roleId" = t."newId"
FROM "user" u, "tmp_role_copy" t
WHERE u."id" = ur."userId"
  AND t."oldId" = ur."roleId"
  AND t."companyId" = COALESCE(u."companyId", ur."companyId");
DELETE FROM "user_role"
WHERE "roleId" IN (SELECT "id" FROM "role" WHERE "companyId" IS NULL);

UPDATE "delegation" d
SET "roleId" = t."newId"
FROM "tmp_role_copy" t
WHERE t."oldId" = d."roleId" AND t."companyId" = d."companyId";

DELETE FROM "role_permission"
WHERE "roleId" IN (SELECT "id" FROM "role" WHERE "companyId" IS NULL);
DELETE FROM "role" WHERE "companyId" IS NULL;

-- 4. A grant no longer names a company: the same role held at several companies is one grant.
DELETE FROM "user_role" a
USING "user_role" b
WHERE a."userId" = b."userId" AND a."roleId" = b."roleId" AND a."id" > b."id";

ALTER TABLE "user_role" DROP CONSTRAINT "user_role_companyId_fkey";
DROP INDEX "user_role_companyId_roleId_idx";
DROP INDEX "user_role_userId_roleId_companyId_key";
ALTER TABLE "user_role" DROP COLUMN "companyId";
CREATE UNIQUE INDEX "user_role_userId_roleId_key" ON "user_role"("userId", "roleId");
CREATE INDEX "user_role_roleId_idx" ON "user_role"("roleId");

-- 5. A role belongs to one company; its code is unique there.
DROP INDEX "role_companyId_name_key";
ALTER TABLE "role" ALTER COLUMN "companyId" SET NOT NULL;
CREATE UNIQUE INDEX "role_companyId_name_key" ON "role"("companyId", "name");

-- 6. The default company roles get their codes (ADMIN, RECEPTIONIST, DISPATCHER,
-- ADMIN_DISPATCHER) and become system roles; the company's « Admin » is the protected ADMIN role.
UPDATE "role" r
SET "code" = d."code", "isSystem" = true
FROM (VALUES
  ('Admin', 'ADMIN'),
  ('Réceptionniste', 'RECEPTIONIST'),
  ('Dispatcher', 'DISPATCHER'),
  ('Admin dispatcher', 'ADMIN_DISPATCHER')
) AS d ("name", "code")
WHERE r."name" = d."name"
  AND r."id" NOT IN (SELECT "newId" FROM "tmp_role_copy")
  AND NOT EXISTS (
    SELECT 1 FROM "role" other
    WHERE other."companyId" = r."companyId" AND other."code" = d."code"
  );

-- Every company has its ADMIN role (never archived).
INSERT INTO "role" ("id", "code", "name", "description", "companyId", "isSystem", "createdAt", "updatedAt")
SELECT gen_random_uuid()::text, 'ADMIN',
  CASE WHEN EXISTS (
    SELECT 1 FROM "role" same WHERE same."companyId" = c."id" AND same."name" = 'Admin'
  ) THEN 'Administrateur (système)' ELSE 'Admin' END,
  'Toutes les permissions de Diffusion', c."id", true, now(), now()
FROM "company" c
WHERE NOT EXISTS (
  SELECT 1 FROM "role" r WHERE r."companyId" = c."id" AND r."code" = 'ADMIN'
);
UPDATE "role"
SET "archivedAt" = NULL, "archivedById" = NULL, "formerUsersCount" = 0
WHERE "code" = 'ADMIN' AND "isSystem" = true;

CREATE UNIQUE INDEX "role_companyId_code_key" ON "role"("companyId", "code");

-- ADMIN holds every permission (CDC G1).
INSERT INTO "role_permission" ("permissionId", "roleId")
SELECT p."id", r."id"
FROM "role" r CROSS JOIN "permission" p
WHERE r."code" = 'ADMIN' AND r."isSystem" = true
ON CONFLICT DO NOTHING;

-- The company's administrators (the core's tenantAdmin) hold it.
INSERT INTO "user_role" ("id", "userId", "roleId")
SELECT gen_random_uuid()::text, u."id", r."id"
FROM "user" u
JOIN "role" r ON r."companyId" = u."companyId" AND r."code" = 'ADMIN' AND r."isSystem" = true
WHERE u."accessProfile" = 'COMPANY_ADMIN'
ON CONFLICT DO NOTHING;

DROP TABLE "tmp_replaces";
DROP TABLE "tmp_implies";
DROP TABLE "tmp_role_copy";
