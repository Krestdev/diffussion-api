-- AlterEnum
ALTER TYPE "ValidationDecision" ADD VALUE 'AVIS';

-- AlterTable
ALTER TABLE "validation" ADD COLUMN     "comment" TEXT;

