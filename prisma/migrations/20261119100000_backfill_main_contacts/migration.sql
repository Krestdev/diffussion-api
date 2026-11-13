-- The legacy main contact of each correspondent becomes one of its contacts.
-- Only its name: the correspondent's phone and e-mail are the organisation's.
INSERT INTO "correspondent_contact" ("id", "correspondentId", "name", "createdAt", "updatedAt")
SELECT gen_random_uuid()::text, c."id", left(trim(c."mainContact"), 150), now(), now()
FROM "correspondent" c
WHERE c."mainContact" IS NOT NULL
  AND trim(c."mainContact") <> ''
  AND NOT EXISTS (
    SELECT 1 FROM "correspondent_contact" cc
    WHERE cc."correspondentId" = c."id"
      AND lower(cc."name") = lower(trim(c."mainContact"))
  );
