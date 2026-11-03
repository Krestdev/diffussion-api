-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "CourrierStatus" ADD VALUE 'AFFECTE';
ALTER TYPE "CourrierStatus" ADD VALUE 'SIGNE';
ALTER TYPE "CourrierStatus" ADD VALUE 'DECHARGE';

-- AlterTable
ALTER TABLE "courrier" ADD COLUMN     "bordereauNumber" VARCHAR(30),
ADD COLUMN     "closedAt" TIMESTAMP(3),
ADD COLUMN     "closingNote" TEXT,
ADD COLUMN     "dischargeDocumentId" TEXT,
ADD COLUMN     "dischargeReceivedBy" VARCHAR(255),
ADD COLUMN     "signedAt" TIMESTAMP(3),
ADD COLUMN     "signedById" TEXT,
ADD COLUMN     "signedDocumentId" TEXT,
ADD COLUMN     "transmissionMode" VARCHAR(100),
ADD COLUMN     "transmissionRecipient" VARCHAR(255),
ADD COLUMN     "transmittedAt" TIMESTAMP(3),
ADD COLUMN     "transmittedById" TEXT;

-- CreateTable
CREATE TABLE "bordereau_sequence" (
    "year" INTEGER NOT NULL,
    "last" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "bordereau_sequence_pkey" PRIMARY KEY ("year")
);

-- CreateIndex
CREATE UNIQUE INDEX "courrier_signedDocumentId_key" ON "courrier"("signedDocumentId");

-- CreateIndex
CREATE UNIQUE INDEX "courrier_bordereauNumber_key" ON "courrier"("bordereauNumber");

-- CreateIndex
CREATE UNIQUE INDEX "courrier_dischargeDocumentId_key" ON "courrier"("dischargeDocumentId");

-- AddForeignKey
ALTER TABLE "courrier" ADD CONSTRAINT "courrier_transmittedById_fkey" FOREIGN KEY ("transmittedById") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "courrier" ADD CONSTRAINT "courrier_signedById_fkey" FOREIGN KEY ("signedById") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "courrier" ADD CONSTRAINT "courrier_signedDocumentId_fkey" FOREIGN KEY ("signedDocumentId") REFERENCES "document"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "courrier" ADD CONSTRAINT "courrier_dischargeDocumentId_fkey" FOREIGN KEY ("dischargeDocumentId") REFERENCES "document"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- Backfill: a sortant already sent was transmitted when it was sent; an
-- entrant already handed over, when its dispatching was validated.
UPDATE "courrier" SET "transmittedAt" = "sentAt"
WHERE "direction" = 'SORTANT' AND "sentAt" IS NOT NULL;

UPDATE "courrier"
SET "transmittedAt" = "dispatchValidatedAt", "transmittedById" = "dispatchValidatedById"
WHERE "direction" = 'ENTRANT' AND "dispatchValidatedAt" IS NOT NULL
  AND "status" NOT IN ('RECU', 'ENREGISTRE', 'EN_ATTENTE_TRANSMISSION');
