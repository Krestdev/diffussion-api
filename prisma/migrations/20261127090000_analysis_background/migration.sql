-- The fiche d'analyse's background (PA·3): an A4 PDF, PNG or JPEG drawn behind every page of
-- its PDF. Common (app_settings) and each company's own over it (company_settings), as the logo.
-- IF NOT EXISTS: a database that applied this change under its first name
-- (20261120000000_analysis_background, before sites became companies) already has the columns.
ALTER TABLE "app_settings" ADD COLUMN IF NOT EXISTS "analysisBackgroundKey" TEXT;
ALTER TABLE "app_settings" ADD COLUMN IF NOT EXISTS "analysisBackgroundMime" VARCHAR(50);
ALTER TABLE "company_settings" ADD COLUMN IF NOT EXISTS "analysisBackgroundKey" TEXT;
ALTER TABLE "company_settings" ADD COLUMN IF NOT EXISTS "analysisBackgroundMime" VARCHAR(50);
