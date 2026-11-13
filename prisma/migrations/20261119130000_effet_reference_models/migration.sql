-- AlterTable
ALTER TABLE "effet_type" ADD COLUMN     "referenceModel" JSONB;

-- AlterTable
ALTER TABLE "instruction" ADD COLUMN     "assignedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "effet_reference_sequence" (
    "effetTypeId" TEXT NOT NULL,
    "siteKey" VARCHAR(36) NOT NULL,
    "period" VARCHAR(7) NOT NULL,
    "last" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "effet_reference_sequence_pkey" PRIMARY KEY ("effetTypeId","siteKey","period")
);

-- AddForeignKey
ALTER TABLE "effet_reference_sequence" ADD CONSTRAINT "effet_reference_sequence_effetTypeId_fkey" FOREIGN KEY ("effetTypeId") REFERENCES "effet_type"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Every existing type gets a model; effets already numbered keep their reference.
UPDATE "effet_type" SET "referenceModel" = jsonb_build_object(
  'prefix', CASE
    WHEN "siteId" IS NOT NULL THEN 'EFF'
    WHEN "name" = 'Courrier' THEN 'LET'
    WHEN "name" = 'Bordereau de transmission' THEN 'BT'
    WHEN "name" = 'Document' THEN 'DOC'
    WHEN "name" = 'Dossier complet' THEN 'DOS'
    WHEN "name" = 'Matière / spécimen' THEN 'MAT'
    WHEN "name" = 'Support numérique' THEN 'SUP'
    ELSE 'EFF'
  END,
  'separator', '-',
  'counterDigits', 6,
  'counterReset', 'YEARLY',
  'yearDigits', 4,
  'monthIncluded', false,
  'codes', '[]'::jsonb
);

-- No assignment date was kept: a task's creation is the closest one.
UPDATE "instruction" i SET "assignedAt" = i."createdAt"
WHERE EXISTS (
  SELECT 1 FROM "user_instructions" u
  WHERE u."instructionId" = i."id" AND u."role" IN ('EXECUTANT', 'SUPERVISEUR')
);
