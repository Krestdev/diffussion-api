-- AlterTable
ALTER TABLE "document"
  ALTER COLUMN "canal" TYPE VARCHAR(10) USING "canal"::text,
  ADD COLUMN "direction" VARCHAR(10),
  ADD COLUMN "modificationAuthorized" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "transmittedAt" TIMESTAMP(3),
  ADD COLUMN "scanUrl" VARCHAR(255),
  ADD COLUMN "rejectionMotif" VARCHAR(255),
  ADD COLUMN "dechargeAt" TIMESTAMP(3),
  ADD COLUMN "dechargeByUuid" INTEGER;

-- AddForeignKey
ALTER TABLE "document" ADD CONSTRAINT "document_dechargeByUuid_fkey" FOREIGN KEY ("dechargeByUuid") REFERENCES "utilisateur"("uuid") ON DELETE SET NULL ON UPDATE CASCADE;
