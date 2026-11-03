-- AlterTable
ALTER TABLE "courrier" ADD COLUMN     "approvedAt" TIMESTAMP(3),
ADD COLUMN     "approvedById" TEXT,
ADD COLUMN     "archiveReason" TEXT,
ADD COLUMN     "archivedAt" TIMESTAMP(3),
ADD COLUMN     "archivedFromStatus" "CourrierStatus",
ADD COLUMN     "body" TEXT,
ADD COLUMN     "cancellationReason" TEXT,
ADD COLUMN     "cancelledAt" TIMESTAMP(3),
ADD COLUMN     "submittedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "courrier_sequence" (
    "year" INTEGER NOT NULL,
    "last" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "courrier_sequence_pkey" PRIMARY KEY ("year")
);

-- AddForeignKey
ALTER TABLE "courrier" ADD CONSTRAINT "courrier_approvedById_fkey" FOREIGN KEY ("approvedById") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- Effets already approved: their approval is their last VALIDE decision.
UPDATE "courrier" AS c
SET "approvedAt" = v."decidedAt", "approvedById" = v."validatorId"
FROM (
  SELECT DISTINCT ON ("courrierId") "courrierId", "decidedAt", "validatorId"
  FROM "validation"
  WHERE "courrierId" IS NOT NULL AND "decision" = 'VALIDE'
  ORDER BY "courrierId", "decidedAt" DESC
) AS v
WHERE v."courrierId" = c."id"
  AND c."status" IN ('VALIDE', 'PRET_A_ENVOYER', 'ENVOYE', 'CLOTURE', 'ARCHIVE');

-- Sortants already approved get their outgoing reference, numbered per year
-- in the order they were approved; the sequence continues from there.
WITH "numbered" AS (
  SELECT "id",
         EXTRACT(YEAR FROM COALESCE("approvedAt", "updatedAt"))::int AS "year",
         ROW_NUMBER() OVER (
           PARTITION BY EXTRACT(YEAR FROM COALESCE("approvedAt", "updatedAt"))
           ORDER BY COALESCE("approvedAt", "updatedAt"), "id"
         ) AS "n"
  FROM "courrier"
  WHERE "direction" = 'SORTANT'
    AND "status" IN ('VALIDE', 'PRET_A_ENVOYER', 'ENVOYE')
    AND "reference" IS NULL
)
UPDATE "courrier" AS c
SET "reference" = 'SOR-' || n."year" || '-' || LPAD(n."n"::text, 6, '0')
FROM "numbered" AS n
WHERE n."id" = c."id";

INSERT INTO "courrier_sequence" ("year", "last")
SELECT CAST(SUBSTRING("reference" FROM 5 FOR 4) AS INTEGER),
       MAX(CAST(SUBSTRING("reference" FROM 10) AS INTEGER))
FROM "courrier"
WHERE "reference" ~ '^SOR-[0-9]{4}-[0-9]{6}$'
GROUP BY 1;

-- Effets already archived were archived once closed.
UPDATE "courrier"
SET "archivedFromStatus" = 'CLOTURE', "archivedAt" = "updatedAt"
WHERE "status" = 'ARCHIVE';
