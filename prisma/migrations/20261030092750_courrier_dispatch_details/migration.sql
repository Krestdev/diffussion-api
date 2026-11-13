-- AlterTable
ALTER TABLE "courrier" ADD COLUMN     "dispatchValidatedAt" TIMESTAMP(3),
ADD COLUMN     "dispatchValidatedById" TEXT,
ADD COLUMN     "supervisorDueDate" TIMESTAMP(3),
ADD COLUMN     "supervisorNote" TEXT;

-- AddForeignKey
ALTER TABLE "courrier" ADD CONSTRAINT "courrier_dispatchValidatedById_fkey" FOREIGN KEY ("dispatchValidatedById") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;
