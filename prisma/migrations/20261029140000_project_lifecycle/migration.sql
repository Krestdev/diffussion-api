-- CreateEnum
CREATE TYPE "ProjectStatus" AS ENUM ('ACTIVE', 'CLOSED', 'ARCHIVED');

-- AlterTable
ALTER TABLE "project" ADD COLUMN     "archivedAt" TIMESTAMP(3),
ADD COLUMN     "closedAt" TIMESTAMP(3),
ADD COLUMN     "endDate" TIMESTAMP(3),
ADD COLUMN     "responsibleId" TEXT,
ADD COLUMN     "startDate" TIMESTAMP(3),
ADD COLUMN     "status" "ProjectStatus" NOT NULL DEFAULT 'ACTIVE';

-- CreateIndex
CREATE INDEX "project_status_idx" ON "project"("status");

-- CreateIndex
CREATE INDEX "project_responsibleId_idx" ON "project"("responsibleId");

-- AddForeignKey
ALTER TABLE "project" ADD CONSTRAINT "project_responsibleId_fkey" FOREIGN KEY ("responsibleId") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

