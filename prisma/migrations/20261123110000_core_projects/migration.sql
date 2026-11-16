-- Projects come from the CREAPP core (owner, 2026-11-23, as EXPENZO since 2026-11-03): the core
-- owns them and sends them in the directory once it does (Tenant.projectsSince); Diffusion keeps
-- read-only copies under the same ids (src/core/project-sync.ts). Diffusion's own fields
-- (contentType, mode, maître d'ouvrage, who may open it) stay Diffusion's.

-- 1. The core's SUSPENDED status: still offered, marked in the pickers.
ALTER TYPE "ProjectStatus" ADD VALUE IF NOT EXISTS 'SUSPENDED' BEFORE 'CLOSED';

-- 2. Names are unique per company at the core (by reference), not across Diffusion.
DROP INDEX IF EXISTS "project_name_key";

-- 3. The core's fields Diffusion didn't have, and when the sync last wrote the copy (null: made in
--    Diffusion before the core owned projects; never deleted by the sync).
ALTER TABLE "project"
  ADD COLUMN "description" TEXT,
  ADD COLUMN "budget" DECIMAL(20,6),
  ADD COLUMN "statusReason" TEXT,
  ADD COLUMN "coreSyncedAt" TIMESTAMP(3);

-- 4. A copy new from the core holds dossiers until Diffusion's settings of the project say otherwise.
ALTER TABLE "project" ALTER COLUMN "contentType" SET DEFAULT 'DOSSIERS';

CREATE INDEX "project_companyId_reference_idx" ON "project"("companyId", "reference");

-- 5. Permission catalogue 2.1.0: project.create and project.archive are withdrawn (projects are
--    created, suspended, closed and deleted in the core's console). PermissionsUpgradeService
--    also drops them from every role at start-up; removing the rows keeps the catalogue clean.
DELETE FROM "role_permission"
WHERE "permissionId" IN (
  SELECT "id" FROM "permission" WHERE "code" IN ('project.create', 'project.archive')
);
DELETE FROM "permission" WHERE "code" IN ('project.create', 'project.archive');
