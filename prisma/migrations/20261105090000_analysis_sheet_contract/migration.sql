-- AlterTable
ALTER TABLE "analysis_sheet" ADD COLUMN     "contractId" TEXT,
ALTER COLUMN "dossierId" DROP NOT NULL;

-- CreateIndex
CREATE INDEX "analysis_sheet_contractId_idx" ON "analysis_sheet"("contractId");

-- AddForeignKey
ALTER TABLE "analysis_sheet" ADD CONSTRAINT "analysis_sheet_contractId_fkey" FOREIGN KEY ("contractId") REFERENCES "contract"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Backfill: each fiche takes its courrier's contract.
UPDATE "analysis_sheet" s
SET "contractId" = c."contractId"
FROM "courrier" c
WHERE c."id" = s."courrierId" AND c."contractId" IS NOT NULL;
