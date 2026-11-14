-- Diffusion has no "sites" any more: the concept is the company (the CREAPP
-- core's company, same id). Everything is renamed in place: tables, the
-- status enum, every "siteId" / "siteKey" column, and the constraints and
-- indexes named after them. No data moves.

-- Tables
ALTER TABLE "site" RENAME TO "company";
ALTER TABLE "site_settings" RENAME TO "company_settings";
ALTER TABLE "analysis_site_settings" RENAME TO "analysis_company_settings";

-- Enum
ALTER TYPE "SiteStatus" RENAME TO "CompanyStatus";

DO $$
DECLARE
  r record;
BEGIN
  -- Columns: siteId -> companyId, siteKey -> companyKey
  FOR r IN
    SELECT table_name, column_name
    FROM information_schema.columns
    WHERE table_schema = current_schema()
      AND column_name IN ('siteId', 'siteKey')
  LOOP
    EXECUTE format(
      'ALTER TABLE %I RENAME COLUMN %I TO %I',
      r.table_name, r.column_name, replace(r.column_name, 'site', 'company')
    );
  END LOOP;

  -- Constraints (primary keys, foreign keys, unique keys) named after a site
  FOR r IN
    SELECT c.conname, t.relname
    FROM pg_constraint c
    JOIN pg_class t ON t.oid = c.conrelid
    JOIN pg_namespace n ON n.oid = t.relnamespace
    WHERE n.nspname = current_schema()
      AND c.conname ~ '(^|_)site'
  LOOP
    EXECUTE format(
      'ALTER TABLE %I RENAME CONSTRAINT %I TO %I',
      r.relname, r.conname, regexp_replace(r.conname, '(^|_)site', '\1company', 'g')
    );
  END LOOP;

  -- Remaining indexes named after a site
  FOR r IN
    SELECT indexname
    FROM pg_indexes
    WHERE schemaname = current_schema()
      AND indexname ~ '(^|_)site'
  LOOP
    EXECUTE format(
      'ALTER INDEX %I RENAME TO %I',
      r.indexname, regexp_replace(r.indexname, '(^|_)site', '\1company', 'g')
    );
  END LOOP;
END $$;

-- The permission that managed sites now manages companies.
UPDATE "permission"
SET "code" = 'ADMIN_MANAGE_COMPANIES', "description" = 'Gérer les sociétés'
WHERE "code" = 'ADMIN_MANAGE_SITES';

-- The audit journal names companies.
UPDATE "activity_log" SET "entityType" = 'company' WHERE "entityType" = 'site';
UPDATE "activity_log"
SET "action" = 'company.' || substring("action" FROM 6)
WHERE "action" LIKE 'site.%';
