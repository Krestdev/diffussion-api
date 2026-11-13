-- AlterTable
ALTER TABLE "circuit_instance" ADD COLUMN     "documentId" TEXT;

-- AlterTable
ALTER TABLE "courrier" ADD COLUMN     "ownerId" TEXT;

-- AlterTable
ALTER TABLE "document" ADD COLUMN     "ownerId" TEXT;

-- AddForeignKey
ALTER TABLE "courrier" ADD CONSTRAINT "courrier_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "document" ADD CONSTRAINT "document_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "circuit_instance" ADD CONSTRAINT "circuit_instance_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "document"("id") ON DELETE SET NULL ON UPDATE CASCADE;
