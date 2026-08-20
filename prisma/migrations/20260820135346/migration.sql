/*
  Warnings:

  - You are about to drop the column `datetime` on the `audit_log` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "audit_log" DROP COLUMN "datetime";
