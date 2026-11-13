-- CreateEnum
CREATE TYPE "ContractStatus" AS ENUM ('ACTIVE', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "ContractType" AS ENUM ('MOE', 'AMO', 'TRAVAUX', 'ETUDES', 'CONTROLE', 'AUTRE');

-- AlterTable
ALTER TABLE "contract" ADD COLUMN     "amount" DECIMAL(15,2),
ADD COLUMN     "archiveReason" TEXT,
ADD COLUMN     "archivedAt" TIMESTAMP(3),
ADD COLUMN     "clientId" TEXT,
ADD COLUMN     "responsibleId" TEXT,
ADD COLUMN     "signedAt" TIMESTAMP(3),
ADD COLUMN     "status" "ContractStatus" NOT NULL DEFAULT 'ACTIVE',
ADD COLUMN     "tenderReference" VARCHAR(100),
ADD COLUMN     "type" "ContractType";

-- AlterTable
ALTER TABLE "document" ADD COLUMN     "contractId" TEXT;

-- AlterTable
ALTER TABLE "dossier" ADD COLUMN     "archiveReason" TEXT;

-- AlterTable
ALTER TABLE "project" ADD COLUMN     "archiveReason" TEXT;

-- CreateTable
CREATE TABLE "project_access" (
    "projectId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "project_access_pkey" PRIMARY KEY ("projectId","userId")
);

-- CreateTable
CREATE TABLE "contract_access" (
    "contractId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "contract_access_pkey" PRIMARY KEY ("contractId","userId")
);

-- CreateIndex
CREATE INDEX "project_access_userId_idx" ON "project_access"("userId");

-- CreateIndex
CREATE INDEX "contract_access_userId_idx" ON "contract_access"("userId");

-- CreateIndex
CREATE INDEX "contract_status_idx" ON "contract"("status");

-- AddForeignKey
ALTER TABLE "contract" ADD CONSTRAINT "contract_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "correspondent"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contract" ADD CONSTRAINT "contract_responsibleId_fkey" FOREIGN KEY ("responsibleId") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_access" ADD CONSTRAINT "project_access_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_access" ADD CONSTRAINT "project_access_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contract_access" ADD CONSTRAINT "contract_access_contractId_fkey" FOREIGN KEY ("contractId") REFERENCES "contract"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contract_access" ADD CONSTRAINT "contract_access_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "document" ADD CONSTRAINT "document_contractId_fkey" FOREIGN KEY ("contractId") REFERENCES "contract"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

