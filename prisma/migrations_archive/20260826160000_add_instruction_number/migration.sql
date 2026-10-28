-- Add a human-readable reference number to Instruction, matching
-- Dossier/Courrier/Site/Role/Correspondent (written by hand: `prisma
-- migrate dev` refuses to run non-interactively when a required column has
-- to be backfilled on a non-empty table).

ALTER TABLE "instruction" ADD COLUMN "number" VARCHAR(30);
WITH numbered AS (
  SELECT id, 'T-' || lpad(row_number() OVER (ORDER BY "createdAt")::text, 3, '0') AS new_number
  FROM "instruction"
)
UPDATE "instruction" i SET "number" = n.new_number FROM numbered n WHERE i.id = n.id;
ALTER TABLE "instruction" ALTER COLUMN "number" SET NOT NULL;
CREATE UNIQUE INDEX "instruction_number_key" ON "instruction"("number");
