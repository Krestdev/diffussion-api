-- AlterTable
ALTER TABLE "courrier" ADD COLUMN     "contractId" TEXT,
ADD COLUMN     "projectId" TEXT,
ADD COLUMN     "proposedAt" TIMESTAMP(3),
ADD COLUMN     "proposedById" TEXT,
ADD COLUMN     "proposedContractId" TEXT,
ADD COLUMN     "proposedDossierId" TEXT,
ADD COLUMN     "proposedProjectId" TEXT,
ADD COLUMN     "supervisorId" TEXT;

-- CreateIndex
CREATE INDEX "courrier_projectId_idx" ON "courrier"("projectId");

-- CreateIndex
CREATE INDEX "courrier_contractId_idx" ON "courrier"("contractId");

-- AddForeignKey
ALTER TABLE "courrier" ADD CONSTRAINT "courrier_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "project"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "courrier" ADD CONSTRAINT "courrier_contractId_fkey" FOREIGN KEY ("contractId") REFERENCES "contract"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "courrier" ADD CONSTRAINT "courrier_supervisorId_fkey" FOREIGN KEY ("supervisorId") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "courrier" ADD CONSTRAINT "courrier_proposedById_fkey" FOREIGN KEY ("proposedById") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;
