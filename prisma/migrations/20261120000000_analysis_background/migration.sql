-- Per-site (and common) A4 background PDF for the fiche d'analyse renderer.
ALTER TABLE "app_settings"  ADD COLUMN "analysisBackgroundKey"  TEXT;
ALTER TABLE "app_settings"  ADD COLUMN "analysisBackgroundMime" VARCHAR(50);
ALTER TABLE "site_settings" ADD COLUMN "analysisBackgroundKey"  TEXT;
ALTER TABLE "site_settings" ADD COLUMN "analysisBackgroundMime" VARCHAR(50);
