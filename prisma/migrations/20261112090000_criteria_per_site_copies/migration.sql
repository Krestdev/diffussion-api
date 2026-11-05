-- Every site has its own analysis criteria: each existing site gets a copy
-- of the common ones (the model), which stay as the template copied onto
-- sites created later. Fiches already filled keep their own criteria.
INSERT INTO "analysis_criterion_template"
  ("id", "label", "description", "order", "isActive", "appliedByDefault", "siteId", "createdAt", "updatedAt")
SELECT gen_random_uuid()::text, t."label", t."description", t."order", t."isActive",
       t."appliedByDefault", s."id", now(), now()
FROM "analysis_criterion_template" t
CROSS JOIN "site" s
WHERE t."siteId" IS NULL
ON CONFLICT ("siteId", "label") DO NOTHING;
