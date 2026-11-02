-- Contracts (marchés): optionally part of a project, they contain dossiers.
-- Notification preferences: the types each user chose not to receive.

-- AlterTable
ALTER TABLE "dossier" ADD COLUMN     "contractId" TEXT;

-- CreateTable
CREATE TABLE "contract" (
    "id" TEXT NOT NULL,
    "number" VARCHAR(30) NOT NULL,
    "title" VARCHAR(200) NOT NULL,
    "reference" VARCHAR(100),
    "description" TEXT,
    "projectId" TEXT,
    "startDate" TIMESTAMP(3),
    "endDate" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "contract_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notification_preference" (
    "userId" TEXT NOT NULL,
    "type" VARCHAR(50) NOT NULL,
    "enabled" BOOLEAN NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "notification_preference_pkey" PRIMARY KEY ("userId","type")
);

-- CreateIndex
CREATE UNIQUE INDEX "contract_number_key" ON "contract"("number");

-- CreateIndex
CREATE INDEX "contract_projectId_idx" ON "contract"("projectId");

-- AddForeignKey
ALTER TABLE "dossier" ADD CONSTRAINT "dossier_contractId_fkey" FOREIGN KEY ("contractId") REFERENCES "contract"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contract" ADD CONSTRAINT "contract_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notification_preference" ADD CONSTRAINT "notification_preference_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;
