-- CourrierStatus: collapse EN_VERIFICATION/EN_VALIDATION into a single
-- EN_CIRCUIT status now that the number of approval steps is driven by a
-- CircuitInstance (BAD 10.6 / RG-VAL-*) instead of being a fixed 2-step gate.
CREATE TYPE "CourrierStatus_new" AS ENUM ('RECU', 'ENREGISTRE', 'TRANSMIS', 'EN_TRAITEMENT', 'EN_ATTENTE', 'BROUILLON', 'EN_CIRCUIT', 'A_CORRIGER', 'VALIDE', 'PRET_A_ENVOYER', 'ENVOYE', 'ANNULE', 'CLOTURE', 'ARCHIVE');

ALTER TABLE "courrier" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "courrier" ALTER COLUMN "status" TYPE "CourrierStatus_new" USING (
  CASE "status"::text
    WHEN 'EN_VERIFICATION' THEN 'EN_CIRCUIT'
    WHEN 'EN_VALIDATION' THEN 'EN_CIRCUIT'
    ELSE "status"::text
  END
)::"CourrierStatus_new";
ALTER TABLE "courrier" ALTER COLUMN "status" SET DEFAULT 'RECU';

DROP TYPE "CourrierStatus";
ALTER TYPE "CourrierStatus_new" RENAME TO "CourrierStatus";

-- CircuitInstance: track whether an instance is still progressing through
-- its circuit or has reached a terminal state.
CREATE TYPE "CircuitInstanceStatus" AS ENUM ('IN_PROGRESS', 'COMPLETED', 'CANCELLED');

ALTER TABLE "circuit_instance" ADD COLUMN "status" "CircuitInstanceStatus" NOT NULL DEFAULT 'IN_PROGRESS';
ALTER TABLE "circuit_instance" ADD COLUMN "completedAt" TIMESTAMP(3);
