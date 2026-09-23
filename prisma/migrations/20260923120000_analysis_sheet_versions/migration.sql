-- A rejected fiche is kept and superseded by a new version, so a courrier may
-- carry several sheets — only one of them live at a time (enforced in the
-- service, since "live" depends on the owning livrable's status).
DROP INDEX "analysis_sheet_courrierId_key";
CREATE INDEX "analysis_sheet_courrierId_idx" ON "analysis_sheet"("courrierId");

ALTER TABLE "analysis_sheet" ADD COLUMN "parentSheetId" TEXT;
CREATE UNIQUE INDEX "analysis_sheet_parentSheetId_key" ON "analysis_sheet"("parentSheetId");
ALTER TABLE "analysis_sheet" ADD CONSTRAINT "analysis_sheet_parentSheetId_fkey" FOREIGN KEY ("parentSheetId") REFERENCES "analysis_sheet"("id") ON DELETE SET NULL ON UPDATE CASCADE;
