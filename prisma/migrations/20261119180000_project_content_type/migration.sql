-- A project now holds either dossiers or contracts, chosen at its creation.
CREATE TYPE "ProjectContentType" AS ENUM ('DOSSIERS', 'CONTRATS');

ALTER TABLE "project" ADD COLUMN "contentType" "ProjectContentType";

-- A project holding both is split: it keeps its dossiers outside any contract,
-- and a new project "<name> – Contrats", a copy of it, takes its contracts with
-- everything under them.
DO $$
DECLARE
  mixed RECORD;
  split TEXT;
BEGIN
  FOR mixed IN
    SELECT p.*
    FROM "project" p
    WHERE EXISTS (SELECT 1 FROM "contract" c WHERE c."projectId" = p."id")
      AND EXISTS (
        SELECT 1 FROM "dossier" d
        WHERE d."projectId" = p."id" AND d."contractId" IS NULL
      )
  LOOP
    split := gen_random_uuid()::text;

    INSERT INTO "project" (
      "id", "name", "reference", "mode", "maitreOuvrageId", "responsibleId",
      "siteId", "status", "startDate", "endDate", "closedAt", "archivedAt",
      "archiveReason", "createdAt", "updatedAt"
    ) VALUES (
      split, mixed."name" || ' – Contrats', mixed."reference", mixed."mode",
      mixed."maitreOuvrageId", mixed."responsibleId", mixed."siteId",
      mixed."status", mixed."startDate", mixed."endDate", mixed."closedAt",
      mixed."archivedAt", mixed."archiveReason", mixed."createdAt", now()
    );

    INSERT INTO "project_access" ("projectId", "userId", "createdAt")
    SELECT split, "userId", "createdAt"
    FROM "project_access"
    WHERE "projectId" = mixed."id";

    UPDATE "dossier" SET "projectId" = split
    WHERE "projectId" = mixed."id"
      AND "contractId" IN (SELECT "id" FROM "contract" WHERE "projectId" = mixed."id");

    UPDATE "courrier" SET "projectId" = split
    WHERE "projectId" = mixed."id"
      AND (
        "contractId" IN (SELECT "id" FROM "contract" WHERE "projectId" = mixed."id")
        OR "dossierId" IN (SELECT "id" FROM "dossier" WHERE "projectId" = split)
      );

    UPDATE "courrier" SET "proposedProjectId" = split
    WHERE "proposedProjectId" = mixed."id"
      AND "proposedContractId" IN (SELECT "id" FROM "contract" WHERE "projectId" = mixed."id");

    UPDATE "analysis_sheet" SET "projectId" = split
    WHERE "projectId" = mixed."id"
      AND "contractId" IN (SELECT "id" FROM "contract" WHERE "projectId" = mixed."id");

    UPDATE "contract" SET "projectId" = split WHERE "projectId" = mixed."id";
  END LOOP;
END $$;

UPDATE "project" p
SET "contentType" = CASE
  WHEN EXISTS (SELECT 1 FROM "contract" c WHERE c."projectId" = p."id")
    THEN 'CONTRATS'::"ProjectContentType"
  ELSE 'DOSSIERS'::"ProjectContentType"
END;

ALTER TABLE "project" ALTER COLUMN "contentType" SET NOT NULL;
