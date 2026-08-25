/*
  Warnings:

  - The values [TECHNICAL] on the enum `ActivitySource` will be removed. If these variants are still used in the database, this will fail.
  - You are about to drop the column `changes` on the `activity_log` table. All the data in the column will be lost.
  - You are about to drop the column `metadata` on the `activity_log` table. All the data in the column will be lost.
  - You are about to drop the column `requestId` on the `activity_log` table. All the data in the column will be lost.
  - Changed the type of `action` on the `activity_log` table. No cast exists, the column would be dropped and recreated, which cannot be done if there is data, since the column is required.

*/
-- CreateEnum
CREATE TYPE "ActionLog" AS ENUM ('CREATE', 'UPDATE', 'DELETE', 'READ');

-- AlterEnum
BEGIN;
CREATE TYPE "ActivitySource_new" AS ENUM ('USER', 'SYSTEM');
ALTER TABLE "activity_log" ALTER COLUMN "source" TYPE "ActivitySource_new" USING ("source"::text::"ActivitySource_new");
ALTER TYPE "ActivitySource" RENAME TO "ActivitySource_old";
ALTER TYPE "ActivitySource_new" RENAME TO "ActivitySource";
DROP TYPE "public"."ActivitySource_old";
COMMIT;

-- DropIndex
DROP INDEX "activity_log_requestId_idx";

-- AlterTable
ALTER TABLE "activity_log" DROP COLUMN "changes",
DROP COLUMN "metadata",
DROP COLUMN "requestId",
ADD COLUMN     "parentLogId" TEXT,
DROP COLUMN "action",
ADD COLUMN     "action" "ActionLog" NOT NULL;

-- CreateIndex
CREATE INDEX "activity_log_parentLogId_idx" ON "activity_log"("parentLogId");
