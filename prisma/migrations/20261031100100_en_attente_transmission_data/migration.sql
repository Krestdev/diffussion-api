-- Dispatch proposals waited in EN_ATTENTE_VALIDATION, shared with the
-- validation of an effet by its dossier's responsible. They now have their
-- own status. Separate migration: a new enum value can't be used in the
-- transaction that adds it.
UPDATE "courrier"
SET "status" = 'EN_ATTENTE_TRANSMISSION'
WHERE "status" = 'EN_ATTENTE_VALIDATION'
  AND "proposedProjectId" IS NOT NULL;
