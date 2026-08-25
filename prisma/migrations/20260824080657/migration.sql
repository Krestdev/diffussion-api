/*
  Warnings:

  - Added the required column `context` to the `system_log` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "system_log" DROP COLUMN "context",
ADD COLUMN     "context" JSONB NOT NULL;
