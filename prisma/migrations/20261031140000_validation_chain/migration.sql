-- AlterEnum
ALTER TYPE "UserInstructionRole" ADD VALUE 'VALIDATEUR';

-- AlterTable
ALTER TABLE "livrable" ADD COLUMN     "validationStep" INTEGER NOT NULL DEFAULT 0;

