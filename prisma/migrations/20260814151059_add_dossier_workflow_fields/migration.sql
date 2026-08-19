-- AlterTable
ALTER TABLE "document"
  ADD COLUMN "numero" VARCHAR(30),
  ADD COLUMN "priorite" VARCHAR(20),
  ADD COLUMN "siteUuid" INTEGER;

-- CreateIndex
CREATE UNIQUE INDEX "document_numero_key" ON "document"("numero");

-- AddForeignKey
ALTER TABLE "document" ADD CONSTRAINT "document_siteUuid_fkey" FOREIGN KEY ("siteUuid") REFERENCES "site"("uuid") ON DELETE SET NULL ON UPDATE CASCADE;
