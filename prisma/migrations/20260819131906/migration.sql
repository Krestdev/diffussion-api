/*
  Warnings:

  - You are about to drop the column `correspondantId` on the `document` table. All the data in the column will be lost.
  - You are about to drop the column `correspondantId` on the `instance_circuit` table. All the data in the column will be lost.
  - You are about to drop the `correspondant` table. If the table is not empty, all the data it contains will be lost.

*/
-- DropForeignKey
ALTER TABLE "document" DROP CONSTRAINT "document_correspondantId_fkey";

-- DropForeignKey
ALTER TABLE "instance_circuit" DROP CONSTRAINT "instance_circuit_correspondantId_fkey";

-- AlterTable
ALTER TABLE "document" DROP COLUMN "correspondantId",
ADD COLUMN     "correspondentId" TEXT;

-- AlterTable
ALTER TABLE "instance_circuit" DROP COLUMN "correspondantId",
ADD COLUMN     "correspondentId" TEXT;

-- DropTable
DROP TABLE "correspondant";

-- CreateTable
CREATE TABLE "correspondent" (
    "id" TEXT NOT NULL,
    "name" VARCHAR(100),
    "type" VARCHAR(10),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "correspondent_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "document" ADD CONSTRAINT "document_correspondentId_fkey" FOREIGN KEY ("correspondentId") REFERENCES "correspondent"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "instance_circuit" ADD CONSTRAINT "instance_circuit_correspondentId_fkey" FOREIGN KEY ("correspondentId") REFERENCES "correspondent"("id") ON DELETE SET NULL ON UPDATE CASCADE;
