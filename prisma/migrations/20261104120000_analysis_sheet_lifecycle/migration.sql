-- CreateEnum
CREATE TYPE "AnalysisSheetStatus" AS ENUM ('BROUILLON', 'ENREGISTREE', 'SIGNEE', 'ARCHIVEE');

-- DropForeignKey
ALTER TABLE "analysis_item" DROP CONSTRAINT "analysis_item_documentId_fkey";

-- AlterTable
ALTER TABLE "analysis_criterion_template" ADD COLUMN     "appliedByDefault" BOOLEAN NOT NULL DEFAULT true;

-- AlterTable
ALTER TABLE "analysis_item" ADD COLUMN     "norms" TEXT,
ALTER COLUMN "documentId" DROP NOT NULL;

-- AlterTable
ALTER TABLE "analysis_sheet" ADD COLUMN     "allotment" VARCHAR(255),
ADD COLUMN     "archiveReason" TEXT,
ADD COLUMN     "archivedAt" TIMESTAMP(3),
ADD COLUMN     "archivedFromStatus" "AnalysisSheetStatus",
ADD COLUMN     "authorFunction" VARCHAR(150),
ADD COLUMN     "comments" TEXT,
ADD COLUMN     "mode" VARCHAR(100),
ADD COLUMN     "owner" VARCHAR(255),
ADD COLUMN     "projectReference" VARCHAR(100),
ADD COLUMN     "signatoryName" VARCHAR(255),
ADD COLUMN     "signedAt" TIMESTAMP(3),
ADD COLUMN     "signedDocumentId" TEXT,
ADD COLUMN     "status" "AnalysisSheetStatus" NOT NULL DEFAULT 'BROUILLON',
ADD COLUMN     "title" VARCHAR(255),
ADD COLUMN     "validatorFunction" VARCHAR(150),
ADD COLUMN     "validatorId" TEXT,
ADD COLUMN     "version" VARCHAR(10) NOT NULL DEFAULT '1.0',
ADD COLUMN     "versionMotif" TEXT,
ALTER COLUMN "livrableId" DROP NOT NULL;

-- CreateTable
CREATE TABLE "analysis_settings" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "allowCustomCriteria" BOOLEAN NOT NULL DEFAULT true,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "analysis_settings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "analysis_sheet_signedDocumentId_key" ON "analysis_sheet"("signedDocumentId");

-- AddForeignKey
ALTER TABLE "analysis_sheet" ADD CONSTRAINT "analysis_sheet_validatorId_fkey" FOREIGN KEY ("validatorId") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "analysis_sheet" ADD CONSTRAINT "analysis_sheet_signedDocumentId_fkey" FOREIGN KEY ("signedDocumentId") REFERENCES "document"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "analysis_item" ADD CONSTRAINT "analysis_item_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "document"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- Backfill: an existing fiche takes its status from its livrable (still
-- being prepared: BROUILLON; archived: ARCHIVEE; otherwise ENREGISTREE), and
-- its version from its place in its chain of versions (1.0, 1.1...).
UPDATE "analysis_sheet" s
SET "status" = CASE
    WHEN l."status" IN ('EN_PREPARATION', 'DEPOSE') THEN 'BROUILLON'::"AnalysisSheetStatus"
    WHEN l."status" = 'ARCHIVE' THEN 'ARCHIVEE'::"AnalysisSheetStatus"
    ELSE 'ENREGISTREE'::"AnalysisSheetStatus"
  END
FROM "livrable" l
WHERE l."id" = s."livrableId";

WITH RECURSIVE chain AS (
  SELECT "id", 0 AS depth FROM "analysis_sheet" WHERE "parentSheetId" IS NULL
  UNION ALL
  SELECT s."id", c.depth + 1
  FROM "analysis_sheet" s JOIN chain c ON s."parentSheetId" = c."id"
)
UPDATE "analysis_sheet" s
SET "version" = '1.' || chain.depth
FROM chain
WHERE chain."id" = s."id";

INSERT INTO "analysis_settings" ("id", "allowCustomCriteria", "updatedAt")
VALUES (1, true, CURRENT_TIMESTAMP);
