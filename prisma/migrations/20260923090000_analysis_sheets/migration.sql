-- Module "Fiches d'analyse / Avis": one sheet per delivery (courrier entrant),
-- carried by a livrable, one element per analysed document, one grid of
-- criteria per element.

CREATE TYPE "AnalysisOpinion" AS ENUM ('AF', 'AFR', 'AS', 'AD', 'NA');

-- Projet / Marché block of the sheet.
ALTER TABLE "project" ADD COLUMN "reference" VARCHAR(50);
ALTER TABLE "project" ADD COLUMN "mode" VARCHAR(100);
ALTER TABLE "project" ADD COLUMN "maitreOuvrageId" TEXT;
ALTER TABLE "project" ADD CONSTRAINT "project_maitreOuvrageId_fkey" FOREIGN KEY ("maitreOuvrageId") REFERENCES "correspondent"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- The decision trail reuses the table circuits already write to.
ALTER TABLE "validation" ADD COLUMN "analysisSheetId" TEXT;

CREATE TABLE "analysis_criterion_template" (
    "id" TEXT NOT NULL,
    "label" VARCHAR(150) NOT NULL,
    "description" TEXT,
    "dossierTypeId" TEXT,
    "order" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "analysis_criterion_template_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "analysis_criterion_template_label_key" ON "analysis_criterion_template"("label");
ALTER TABLE "analysis_criterion_template" ADD CONSTRAINT "analysis_criterion_template_dossierTypeId_fkey" FOREIGN KEY ("dossierTypeId") REFERENCES "dossier_type"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "analysis_sheet" (
    "id" TEXT NOT NULL,
    "reference" VARCHAR(30) NOT NULL,
    "livrableId" TEXT NOT NULL,
    "courrierId" TEXT NOT NULL,
    "dossierId" TEXT NOT NULL,
    "projectId" TEXT,
    "authorId" TEXT NOT NULL,
    "refBL" VARCHAR(50),
    "lieuUsage" VARCHAR(150),
    "remise" TIMESTAMP(3),
    "norme" VARCHAR(150),
    "docsReferences" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "suggestedOpinion" "AnalysisOpinion",
    "overallOpinion" "AnalysisOpinion",
    "opinionMotif" TEXT,
    "decidedById" TEXT,
    "decidedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "analysis_sheet_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "analysis_sheet_reference_key" ON "analysis_sheet"("reference");
CREATE UNIQUE INDEX "analysis_sheet_livrableId_key" ON "analysis_sheet"("livrableId");
CREATE UNIQUE INDEX "analysis_sheet_courrierId_key" ON "analysis_sheet"("courrierId");
CREATE INDEX "analysis_sheet_dossierId_idx" ON "analysis_sheet"("dossierId");
ALTER TABLE "analysis_sheet" ADD CONSTRAINT "analysis_sheet_livrableId_fkey" FOREIGN KEY ("livrableId") REFERENCES "livrable"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "analysis_sheet" ADD CONSTRAINT "analysis_sheet_courrierId_fkey" FOREIGN KEY ("courrierId") REFERENCES "courrier"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "analysis_sheet" ADD CONSTRAINT "analysis_sheet_dossierId_fkey" FOREIGN KEY ("dossierId") REFERENCES "dossier"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "analysis_sheet" ADD CONSTRAINT "analysis_sheet_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "project"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "analysis_sheet" ADD CONSTRAINT "analysis_sheet_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "analysis_sheet" ADD CONSTRAINT "analysis_sheet_decidedById_fkey" FOREIGN KEY ("decidedById") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "analysis_item" (
    "id" TEXT NOT NULL,
    "sheetId" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "label" VARCHAR(200) NOT NULL,
    "description" TEXT,
    "observation" TEXT,
    "suggestedOpinion" "AnalysisOpinion",
    "opinion" "AnalysisOpinion",
    "order" INTEGER NOT NULL,

    CONSTRAINT "analysis_item_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "analysis_item_sheetId_documentId_key" ON "analysis_item"("sheetId", "documentId");
CREATE UNIQUE INDEX "analysis_item_sheetId_order_key" ON "analysis_item"("sheetId", "order");
ALTER TABLE "analysis_item" ADD CONSTRAINT "analysis_item_sheetId_fkey" FOREIGN KEY ("sheetId") REFERENCES "analysis_sheet"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "analysis_item" ADD CONSTRAINT "analysis_item_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "document"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "analysis_item_criterion" (
    "id" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "templateId" TEXT,
    "label" VARCHAR(150) NOT NULL,
    "opinion" "AnalysisOpinion" NOT NULL DEFAULT 'NA',
    "observation" TEXT,
    "order" INTEGER NOT NULL,

    CONSTRAINT "analysis_item_criterion_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "analysis_item_criterion_itemId_label_key" ON "analysis_item_criterion"("itemId", "label");
ALTER TABLE "analysis_item_criterion" ADD CONSTRAINT "analysis_item_criterion_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "analysis_item"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "analysis_item_criterion" ADD CONSTRAINT "analysis_item_criterion_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "analysis_criterion_template"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "validation" ADD CONSTRAINT "validation_analysisSheetId_fkey" FOREIGN KEY ("analysisSheetId") REFERENCES "analysis_sheet"("id") ON DELETE SET NULL ON UPDATE CASCADE;
