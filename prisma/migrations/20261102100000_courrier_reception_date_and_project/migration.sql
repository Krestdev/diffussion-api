-- An entrant always has its reception date: the registration date when
-- none was recorded (the list already showed that date as "Reçu le").
UPDATE "courrier"
SET "receivedAt" = "createdAt"
WHERE "receivedAt" IS NULL
  AND "direction" = 'ENTRANT';

-- An effet attached to a dossier is in that dossier's project and contract
-- (only dispatching filled them in so far).
UPDATE "courrier" AS c
SET "projectId" = COALESCE(c."projectId", d."projectId"),
    "contractId" = COALESCE(c."contractId", d."contractId")
FROM "dossier" AS d
WHERE c."dossierId" = d."id"
  AND (
    (c."projectId" IS NULL AND d."projectId" IS NOT NULL)
    OR (c."contractId" IS NULL AND d."contractId" IS NOT NULL)
  );
