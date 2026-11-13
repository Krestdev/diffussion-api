-- AlterTable
ALTER TABLE "notification" ADD COLUMN     "instructionId" TEXT;

-- AddForeignKey
ALTER TABLE "notification" ADD CONSTRAINT "notification_instructionId_fkey" FOREIGN KEY ("instructionId") REFERENCES "instruction"("id") ON DELETE SET NULL ON UPDATE CASCADE;

