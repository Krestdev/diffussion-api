-- Documents are no longer classified by category. Categories stay on
-- dossiers, where they drive the retention rule (RG-ARC-001).

ALTER TABLE "document" DROP CONSTRAINT "document_categoryId_fkey";

ALTER TABLE "document" DROP COLUMN "categoryId";
