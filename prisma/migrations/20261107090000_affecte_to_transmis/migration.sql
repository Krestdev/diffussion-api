-- The AFFECTE step is gone: a dispatched entrant is transmitted at once.
-- Entrants left in AFFECTE move to TRANSMIS, as if transmitted when their
-- dispatching was validated.
UPDATE "courrier"
SET "status" = 'TRANSMIS',
    "transmittedAt" = COALESCE("transmittedAt", "dispatchValidatedAt", "updatedAt"),
    "transmittedById" = COALESCE("transmittedById", "dispatchValidatedById")
WHERE "status" = 'AFFECTE';

-- Archived from AFFECTE: unarchiving restores TRANSMIS instead.
UPDATE "courrier"
SET "archivedFromStatus" = 'TRANSMIS',
    "transmittedAt" = COALESCE("transmittedAt", "dispatchValidatedAt", "updatedAt"),
    "transmittedById" = COALESCE("transmittedById", "dispatchValidatedById")
WHERE "archivedFromStatus" = 'AFFECTE';
