-- AlterEnum
ALTER TYPE "InstructionPriority" ADD VALUE 'LOW';

-- DropForeignKey
ALTER TABLE "instruction" DROP CONSTRAINT "instruction_dossierId_fkey";

-- AlterTable
ALTER TABLE "instruction" ADD COLUMN     "assignNote" TEXT,
ADD COLUMN     "cancellationReason" TEXT,
ADD COLUMN     "closingComment" TEXT,
ADD COLUMN     "contractId" TEXT,
ALTER COLUMN "dossierId" DROP NOT NULL;

-- AlterTable
ALTER TABLE "livrable" ADD COLUMN     "agentComment" TEXT;

-- CreateIndex
CREATE INDEX "instruction_contractId_idx" ON "instruction"("contractId");

-- AddForeignKey
ALTER TABLE "instruction" ADD CONSTRAINT "instruction_dossierId_fkey" FOREIGN KEY ("dossierId") REFERENCES "dossier"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "instruction" ADD CONSTRAINT "instruction_contractId_fkey" FOREIGN KEY ("contractId") REFERENCES "contract"("id") ON DELETE SET NULL ON UPDATE CASCADE;
