/*
  Warnings:

  - Changed the type of `action` on the `activity_log` table. No cast exists, the column would be dropped and recreated, which cannot be done if there is data, since the column is required.

*/
-- AlterTable
ALTER TABLE "activity_log" ADD COLUMN     "metadata" JSONB,
DROP COLUMN "action",
ADD COLUMN     "action" VARCHAR(100) NOT NULL;

-- DropEnum
DROP TYPE "ActionLog";

-- AddForeignKey
ALTER TABLE "activity_log" ADD CONSTRAINT "activity_log_parentLogId_fkey" FOREIGN KEY ("parentLogId") REFERENCES "activity_log"("id") ON DELETE SET NULL ON UPDATE CASCADE;
