-- AlterTable
ALTER TABLE "courrier" ADD COLUMN     "respondsToId" TEXT;

-- AddForeignKey
ALTER TABLE "courrier" ADD CONSTRAINT "courrier_respondsToId_fkey" FOREIGN KEY ("respondsToId") REFERENCES "courrier"("id") ON DELETE SET NULL ON UPDATE CASCADE;
