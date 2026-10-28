-- "Répond à": a courrier may reference the courrier it answers (either
-- direction). Cleared, not cascaded, when that courrier is deleted.
ALTER TABLE "courrier" ADD COLUMN "respondsToId" TEXT;

ALTER TABLE "courrier" ADD CONSTRAINT "courrier_respondsToId_fkey" FOREIGN KEY ("respondsToId") REFERENCES "courrier"("id") ON DELETE SET NULL ON UPDATE CASCADE;
