-- A sortant draft can be created with only its subject and attached to its
-- dossier later (still required before the courrier enters its circuit).
ALTER TABLE "courrier" ALTER COLUMN "dossierId" DROP NOT NULL;
