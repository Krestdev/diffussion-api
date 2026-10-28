-- A supervisor decision can target one livrable, so each rejected livrable
-- carries its own motif (individual rejection, request-corrections).
ALTER TABLE "validation" ADD COLUMN "livrableId" TEXT;

CREATE INDEX "validation_livrableId_idx" ON "validation"("livrableId");

ALTER TABLE "validation" ADD CONSTRAINT "validation_livrableId_fkey" FOREIGN KEY ("livrableId") REFERENCES "livrable"("id") ON DELETE CASCADE ON UPDATE CASCADE;
