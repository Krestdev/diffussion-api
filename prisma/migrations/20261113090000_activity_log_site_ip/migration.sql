-- The audit journal by site: each entry carries the site of its object (else
-- of its author) and its author's IP. No foreign key: entries outlive the
-- sites they mention.
ALTER TABLE "activity_log" ADD COLUMN "siteId" TEXT,
ADD COLUMN "ip" VARCHAR(64);

CREATE INDEX "activity_log_siteId_createdAt_idx" ON "activity_log"("siteId", "createdAt");

-- ------------------------------------------------------------- backfill
-- From the object, for the kinds of objects that belong to a site.
UPDATE "activity_log" l SET "siteId" = COALESCE(d."siteId", u."siteId")
FROM "courrier" c
LEFT JOIN "dossier" d ON d."id" = c."dossierId"
LEFT JOIN "user" u ON u."id" = c."createdById"
WHERE lower(l."entityType") = 'courrier' AND l."entityId" = c."id";

UPDATE "activity_log" l SET "siteId" = COALESCE(d."siteId", cd."siteId", cu."siteId", p."siteId")
FROM "instruction" i
LEFT JOIN "dossier" d ON d."id" = i."dossierId"
LEFT JOIN "courrier" c ON c."id" = i."courrierId"
LEFT JOIN "dossier" cd ON cd."id" = c."dossierId"
LEFT JOIN "user" cu ON cu."id" = c."createdById"
LEFT JOIN "contract" k ON k."id" = i."contractId"
LEFT JOIN "project" p ON p."id" = k."projectId"
WHERE lower(l."entityType") = 'instruction' AND l."entityId" = i."id";

UPDATE "activity_log" l SET "siteId" = d."siteId"
FROM "dossier" d WHERE lower(l."entityType") = 'dossier' AND l."entityId" = d."id";

UPDATE "activity_log" l SET "siteId" = p."siteId"
FROM "project" p WHERE lower(l."entityType") = 'project' AND l."entityId" = p."id";

UPDATE "activity_log" l SET "siteId" = p."siteId"
FROM "contract" k JOIN "project" p ON p."id" = k."projectId"
WHERE lower(l."entityType") = 'contract' AND l."entityId" = k."id";

UPDATE "activity_log" l SET "siteId" = COALESCE(d."siteId", u."siteId")
FROM "analysis_sheet" s
LEFT JOIN "dossier" d ON d."id" = s."dossierId"
LEFT JOIN "courrier" c ON c."id" = s."courrierId"
LEFT JOIN "user" u ON u."id" = c."createdById"
WHERE l."entityType" = 'analysis-sheet' AND l."entityId" = s."id";

UPDATE "activity_log" l SET "siteId" = s."id"
FROM "site" s WHERE lower(l."entityType") = 'site' AND l."entityId" = s."id";

UPDATE "activity_log" l SET "siteId" = x."siteId"
FROM "canal" x WHERE l."entityType" = 'canal' AND l."entityId" = x."id";
UPDATE "activity_log" l SET "siteId" = x."siteId"
FROM "correspondent" x WHERE l."entityType" = 'correspondent' AND l."entityId" = x."id";
UPDATE "activity_log" l SET "siteId" = x."siteId"
FROM "analysis_criterion_template" x WHERE l."entityType" = 'analysis-criterion-template' AND l."entityId" = x."id";
UPDATE "activity_log" l SET "siteId" = x."siteId"
FROM "effet_type" x WHERE l."entityType" = 'effet-type' AND l."entityId" = x."id";
UPDATE "activity_log" l SET "siteId" = x."siteId"
FROM "delegation" x WHERE l."entityType" = 'delegation' AND l."entityId" = x."id";

-- Global objects stay without a site; anything else: its author's site.
UPDATE "activity_log" l SET "siteId" = u."siteId"
FROM "user" u
WHERE l."siteId" IS NULL AND l."userId" = u."id"
  AND (l."entityType" IS NULL OR lower(l."entityType") NOT IN (
    'site', 'role', 'category', 'courrier-nature', 'correspondent-type',
    'permission', 'settings', 'analysis-settings', 'analysis-criterion-template',
    'effet-type', 'canal', 'correspondent', 'project', 'contract'));
