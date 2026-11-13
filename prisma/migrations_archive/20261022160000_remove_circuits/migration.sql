-- Validation circuits are gone for good. A courrier is now validated in one
-- step by a designated person (its dossier's responsible, or the site's):
-- EN_ATTENTE_VALIDATION -> VALIDE | A_CORRIGER. Dossier types only existed
-- to pick a circuit; they go too, along with ADMIN_MANAGE_CIRCUITS.

-- Courriers mid-circuit keep waiting, now on their designated validator.
ALTER TYPE "CourrierStatus" RENAME VALUE 'EN_CIRCUIT' TO 'EN_ATTENTE_VALIDATION';

-- Past circuit decisions stay in the courrier's validation history;
-- decisions on circuits started on a document have no courrier and go.
ALTER TABLE "validation" ADD COLUMN "courrierId" TEXT;

UPDATE "validation" v
SET "courrierId" = ci."courrierId"
FROM "circuit_instance" ci
WHERE v."circuitInstanceId" = ci."id";

DELETE FROM "validation"
WHERE "circuitInstanceId" IS NOT NULL
  AND "courrierId" IS NULL;

ALTER TABLE "validation" DROP CONSTRAINT "validation_circuitInstanceId_fkey";
ALTER TABLE "validation" DROP COLUMN "circuitInstanceId";

CREATE INDEX "validation_courrierId_idx" ON "validation"("courrierId");
ALTER TABLE "validation" ADD CONSTRAINT "validation_courrierId_fkey" FOREIGN KEY ("courrierId") REFERENCES "courrier"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Circuit engine.
DROP TABLE "circuit_step_instance_circuit";
DROP TABLE "circuit_instance";
DROP TABLE "circuit_step";
DROP TABLE "circuit";
DROP TYPE "CircuitInstanceStatus";
DROP TYPE "CircuitStepState";

-- Dossier types.
ALTER TABLE "analysis_criterion_template" DROP CONSTRAINT "analysis_criterion_template_dossierTypeId_fkey";
ALTER TABLE "analysis_criterion_template" DROP COLUMN "dossierTypeId";
ALTER TABLE "dossier" DROP CONSTRAINT "dossier_typeId_fkey";
ALTER TABLE "dossier" DROP COLUMN "typeId";
DROP TABLE "dossier_type";

-- Permission.
DELETE FROM "role_permission" rp
USING "permission" p
WHERE rp."permissionId" = p."id"
  AND p."code" = 'ADMIN_MANAGE_CIRCUITS';

DELETE FROM "permission" WHERE "code" = 'ADMIN_MANAGE_CIRCUITS';
